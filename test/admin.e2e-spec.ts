import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (via docker-compose) and the .env
 * ADMIN_API_KEY (dev-admin-key-local-only). Completions are created directly via
 * Prisma so the admin route can be exercised without going through S3/BullMQ.
 * TODO(test-infra): move to a throwaway test DB once one exists — see
 * backend/CLAUDE.md.
 */
describe('Admin completion verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ADMIN_KEY = process.env.ADMIN_API_KEY ?? 'dev-admin-key-local-only';
  const stamp = Date.now();
  let missionId: string;
  let userId: string;
  const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

  async function createPendingCompletion(xpAwarded = 40): Promise<string> {
    const completion = await prisma.completion.create({
      data: { userId, missionId, proofType: 'text', proofText: 'proof', xpAwarded },
      select: { id: true },
    });
    return completion.id;
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
        title: `E2E Admin Mission ${stamp}`,
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
      select: { id: true },
    });
    missionId = mission.id;

    const user = await prisma.user.create({
      data: { isGuest: true, totalXp: 100 },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.completion.deleteMany({ where: { missionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.mission.deleteMany({ where: { id: missionId } });
    await app.close();
  });

  const path = (id: string): string => `/admin/completions/${id}/verification`;

  describe('auth', () => {
    it('returns 403 without an x-admin-key header', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer()).patch(path(id)).send({ status: 'Approved' }).expect(403);
    });

    it('returns 403 with a wrong x-admin-key', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer())
        .patch(path(id))
        .set('x-admin-key', 'wrong-key')
        .send({ status: 'Approved' })
        .expect(403);
    });
  });

  describe('approval', () => {
    it('approves a Pending completion and leaves XP unchanged', async () => {
      const id = await createPendingCompletion();
      await prisma.user.update({ where: { id: userId }, data: { totalXp: 100 } });

      const res = await request(app.getHttpServer())
        .patch(path(id))
        .set('x-admin-key', ADMIN_KEY)
        .send({ status: 'Approved' })
        .expect(200);

      expect(res.body).toMatchObject({
        completionId: id,
        verificationStatus: 'Approved',
        verifiedBy: 'admin',
        rejectionReason: null,
      });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.totalXp).toBe(100);
    });
  });

  describe('rejection', () => {
    it('rejects a Pending completion and decrements XP by xpAwarded', async () => {
      const id = await createPendingCompletion(40);
      await prisma.user.update({ where: { id: userId }, data: { totalXp: 100 } });

      const res = await request(app.getHttpServer())
        .patch(path(id))
        .set('x-admin-key', ADMIN_KEY)
        .send({ status: 'Rejected', rejectionReason: 'Blurry photo' })
        .expect(200);

      expect(res.body).toMatchObject({
        verificationStatus: 'Rejected',
        rejectionReason: 'Blurry photo',
        verifiedBy: 'admin',
      });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.totalXp).toBe(60);
    });

    it('returns 400 when rejecting without a rejectionReason', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer())
        .patch(path(id))
        .set('x-admin-key', ADMIN_KEY)
        .send({ status: 'Rejected' })
        .expect(400);
    });
  });

  describe('conflicts and lookup', () => {
    it('returns 409 when the completion is already resolved', async () => {
      const id = await createPendingCompletion();

      await request(app.getHttpServer())
        .patch(path(id))
        .set('x-admin-key', ADMIN_KEY)
        .send({ status: 'Approved' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(path(id))
        .set('x-admin-key', ADMIN_KEY)
        .send({ status: 'Approved' })
        .expect(409);
    });

    it('returns 404 for a valid but non-existent completion id', async () => {
      await request(app.getHttpServer())
        .patch(path(NONEXISTENT_ID))
        .set('x-admin-key', ADMIN_KEY)
        .send({ status: 'Approved' })
        .expect(404);
    });

    it('returns 400 for an invalid status value', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer())
        .patch(path(id))
        .set('x-admin-key', ADMIN_KEY)
        .send({ status: 'Pending' })
        .expect(400);
    });
  });
});
