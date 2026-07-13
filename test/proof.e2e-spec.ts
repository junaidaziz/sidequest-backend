import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (via docker-compose) AND real LocalStack
 * S3 (bucket sidequest-proofs-dev) — the photo happy-path uploads a real buffer
 * and then GETs the returned presigned URL to prove the object round-trips
 * through LocalStack, not a mock. TODO(test-infra): move to a throwaway test DB
 * once one exists — see backend/CLAUDE.md.
 *
 * A single-crew/setting mission is seeded so the guest can complete it via the
 * proof endpoint regardless of the curated seed state.
 */
describe('Proof submission (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const missionTitle = `E2E Proof Mission ${stamp}`;
  let missionId: string;
  const createdUserIds: string[] = [];

  // 1x1 transparent PNG.
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  /** Creates a fresh guest session and returns its access token + user id. */
  async function createGuest(): Promise<{ token: string; userId: string }> {
    const res = await request(app.getHttpServer()).post('/auth/guest').expect(201);
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken, userId: res.body.user.id };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = app.get(PrismaService);
    await app.init();
    await resetThrottleState(app);

    const mission = await prisma.mission.create({
      data: {
        title: missionTitle,
        category: 'discover',
        description: 'Short teaser.',
        fullBrief: 'The full brief.',
        proofRequirement: 'A photo.',
        estimatedMinutes: 15,
        xpReward: 40,
        difficulty: 'Easy',
        difficultyDots: 1,
        crewTags: ['Solo'],
        settingTags: ['Indoors'],
        costTier: 0,
        isActive: true,
      },
    });
    missionId = mission.id;
  });

  afterAll(async () => {
    await prisma.completion.deleteMany({ where: { missionId } });
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.mission.deleteMany({ where: { id: missionId } });
    await app.close();
  });

  describe('POST /missions/:missionId/proof', () => {
    it('uploads a real photo to LocalStack and returns a working presigned proofUrl', async () => {
      const { token } = await createGuest();

      const res = await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photo', pngBuffer, { filename: 'proof.png', contentType: 'image/png' })
        .expect(201);

      expect(res.body).toMatchObject({
        missionTitle,
        xpAwarded: 40,
        totalXp: 40,
        currentStreak: 1,
        longestStreak: 1,
      });
      expect(res.body.completionId).toEqual(expect.any(String));
      expect(typeof res.body.proofUrl).toBe('string');

      // Prove the object actually landed in LocalStack: fetch the presigned URL
      // and confirm the bytes round-tripped. This fails loudly if the upload was
      // mocked or the bucket/credentials are wrong.
      const download = await fetch(res.body.proofUrl);
      expect(download.status).toBe(200);
      const downloaded = Buffer.from(await download.arrayBuffer());
      expect(downloaded.equals(pngBuffer)).toBe(true);

      // The completion row persisted with an S3 key, not a URL.
      const completion = await prisma.completion.findFirst({
        where: { id: res.body.completionId },
      });
      expect(completion?.proofType).toBe('photo');
      expect(completion?.proofKey).toMatch(/^proofs\/.+\.png$/);
      expect(completion?.proofText).toBeNull();
    });

    it('accepts a text caption and returns a null proofUrl', async () => {
      const { token } = await createGuest();

      const res = await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .set('Authorization', `Bearer ${token}`)
        .field('caption', 'Found the oldest building on the street!')
        .expect(201);

      expect(res.body.proofUrl).toBeNull();
      expect(res.body.xpAwarded).toBe(40);

      const completion = await prisma.completion.findFirst({
        where: { id: res.body.completionId },
      });
      expect(completion?.proofType).toBe('text');
      expect(completion?.proofText).toBe('Found the oldest building on the street!');
      expect(completion?.proofKey).toBeNull();
    });

    it('blocks a guest from a second completion with GUEST_COMPLETION_LIMIT_REACHED', async () => {
      const { token } = await createGuest();

      await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .set('Authorization', `Bearer ${token}`)
        .field('caption', 'First completion')
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .set('Authorization', `Bearer ${token}`)
        .field('caption', 'Second completion')
        .expect(403);

      expect(res.body.message).toBe('GUEST_COMPLETION_LIMIT_REACHED');
    });

    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .field('caption', 'no auth')
        .expect(401);
    });

    it('returns 400 when neither photo nor caption is supplied', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns 400 when both a photo and a caption are supplied', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .set('Authorization', `Bearer ${token}`)
        .field('caption', 'both')
        .attach('photo', pngBuffer, { filename: 'proof.png', contentType: 'image/png' })
        .expect(400);
    });

    it('returns 400 for an unsupported image type', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post(`/missions/${missionId}/proof`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photo', Buffer.from('gif'), { filename: 'proof.gif', contentType: 'image/gif' })
        .expect(400);
    });

    it('returns 404 for a valid but non-existent mission id', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post(`/missions/00000000-0000-0000-0000-000000000000/proof`)
        .set('Authorization', `Bearer ${token}`)
        .field('caption', 'ghost mission')
        .expect(404);
    });
  });
});
