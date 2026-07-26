import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MediaPurpose, MediaStatus } from '@prisma/client';
import { Job } from 'bullmq';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { MediaProcessingProcessor } from './../src/media/media-processing.processor';
import { GenerateVariantsJobData } from './../src/media/media.constants';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev Postgres (docker-compose) AND real LocalStack S3
 * (bucket `sidequest-media`) — every step of the direct-to-S3 flow is real:
 * the presigned PUT actually lands in LocalStack, `confirmUpload` really
 * HEADs the object, and variant generation really runs Sharp against the
 * real uploaded bytes and really uploads each variant back to LocalStack.
 *
 * Variant generation is invoked directly via `MediaProcessingProcessor.process`
 * rather than waiting on the real BullMQ worker to pick up the enqueued job —
 * both exercise the identical code path, but calling it directly keeps the
 * suite deterministic instead of racing an async Redis-driven job with no
 * natural signal for "done" to poll on.
 */
describe('Media pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: MediaProcessingProcessor;
  const createdUserIds: string[] = [];

  // A real, fully pixel-decodable PNG — generated via sharp itself rather
  // than a hand-typed base64 literal. A minimal hand-typed 1x1 PNG (as used
  // by users.e2e-spec.ts, which only ever round-trips it as opaque bytes and
  // never decodes pixels) was tried here first and reproducibly failed
  // libvips' PNG decoder ("vipspng: libpng read error") the moment the
  // variant processor actually tried to resize/re-encode it — confirmed in
  // isolation with plain sharp calls, nothing to do with S3/BullMQ. This 50x50
  // generated image decodes and resizes correctly.
  let pngBuffer: Buffer;

  let token: string;
  let userId: string;
  let missionId: string;

  async function createGuest(): Promise<{ token: string; userId: string }> {
    const res = await request(app.getHttpServer()).post('/auth/guest').expect(201);
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken, userId: res.body.user.id };
  }

  async function runVariantGeneration(mediaAssetId: string): Promise<void> {
    await processor.process({ data: { mediaAssetId } } as Job<GenerateVariantsJobData>);
  }

  async function authorizeUploadConfirmAndProcess(
    purpose: MediaPurpose,
    relatedEntityId?: string,
  ): Promise<string> {
    const authRes = await request(app.getHttpServer())
      .post('/media/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        purpose,
        fileName: 'photo.png',
        mimeType: 'image/png',
        fileSize: pngBuffer.length,
        ...(relatedEntityId ? { relatedEntityId } : {}),
      })
      .expect(201);

    const put = await fetch(authRes.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(pngBuffer),
    });
    expect(put.status).toBeLessThan(300);

    await request(app.getHttpServer())
      .post(`/media/uploads/${authRes.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await runVariantGeneration(authRes.body.mediaId);

    return authRes.body.mediaId as string;
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
    processor = app.get(MediaProcessingProcessor);
    await app.init();
    await resetThrottleState(app);

    pngBuffer = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .png()
      .toBuffer();

    const guest = await createGuest();
    token = guest.token;
    userId = guest.userId;

    const mission = await prisma.mission.create({
      data: {
        title: `Media e2e mission ${Date.now()}`,
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
    if (createdUserIds.length > 0) {
      await prisma.mediaAsset.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (missionId) {
      await prisma.mission.delete({ where: { id: missionId } }).catch(() => undefined);
    }
    await app.close();
  });

  describe('POST /media/uploads -> complete -> variant generation (AVATAR)', () => {
    it('takes a real upload through to READY with real, fetchable variant URLs', async () => {
      const mediaId = await authorizeUploadConfirmAndProcess(MediaPurpose.AVATAR);

      const getRes = await request(app.getHttpServer())
        .get(`/media/${mediaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(getRes.body.status).toBe(MediaStatus.READY);
      expect(getRes.body.variants.length).toBeGreaterThan(0);

      const [variant] = getRes.body.variants;
      const download = await fetch(variant.url);
      expect(download.status).toBe(200);
      const bytes = Buffer.from(await download.arrayBuffer());
      // Re-encoded to WebP by the processor — not a byte-identical copy of
      // the uploaded PNG, but a real, non-empty image.
      expect(bytes.length).toBeGreaterThan(0);

      const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
      expect(asset?.status).toBe(MediaStatus.READY);
      const variantRows = await prisma.mediaVariant.findMany({ where: { mediaAssetId: mediaId } });
      expect(variantRows.length).toBe(getRes.body.variants.length);
    });

    it('rejects confirming an upload where nothing was actually PUT to the presigned URL', async () => {
      const authRes = await request(app.getHttpServer())
        .post('/media/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          purpose: MediaPurpose.AVATAR,
          fileName: 'x.png',
          mimeType: 'image/png',
          fileSize: 10,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/media/uploads/${authRes.body.mediaId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects an unsupported MIME type with 400', async () => {
      await request(app.getHttpServer())
        .post('/media/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          purpose: MediaPurpose.AVATAR,
          fileName: 'x.gif',
          mimeType: 'image/gif',
          fileSize: 10,
        })
        .expect(400);
    });

    it('rejects a relatedEntityId supplied for AVATAR', async () => {
      await request(app.getHttpServer())
        .post('/media/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          purpose: MediaPurpose.AVATAR,
          fileName: 'x.png',
          mimeType: 'image/png',
          fileSize: 10,
          relatedEntityId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
    });

    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer())
        .post('/media/uploads')
        .send({
          purpose: MediaPurpose.AVATAR,
          fileName: 'x.png',
          mimeType: 'image/png',
          fileSize: 10,
        })
        .expect(401);
    });
  });

  describe('GET/DELETE /media/:mediaId ownership', () => {
    it('returns 404 (not 403) for a media asset owned by a different user', async () => {
      const other = await createGuest();
      const otherAuth = await request(app.getHttpServer())
        .post('/media/uploads')
        .set('Authorization', `Bearer ${other.token}`)
        .send({
          purpose: MediaPurpose.AVATAR,
          fileName: 'x.png',
          mimeType: 'image/png',
          fileSize: 10,
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/media/${otherAuth.body.mediaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/media/${otherAuth.body.mediaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('DELETE really removes the object(s) from LocalStack and the DB row', async () => {
      const mediaId = await authorizeUploadConfirmAndProcess(MediaPurpose.AVATAR);
      const before = await request(app.getHttpServer())
        .get(`/media/${mediaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const [variant] = before.body.variants;

      await request(app.getHttpServer())
        .delete(`/media/${mediaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
      expect(asset).toBeNull();

      const download = await fetch(variant.url);
      expect(download.status).not.toBe(200);
    });
  });

  describe('POST /users/me/avatar/media — setting the avatar from the media pipeline', () => {
    it('points the profile avatar at a READY asset and exposes responsive variants', async () => {
      const mediaId = await authorizeUploadConfirmAndProcess(MediaPurpose.AVATAR);

      await request(app.getHttpServer())
        .post('/users/me/avatar/media')
        .set('Authorization', `Bearer ${token}`)
        .send({ mediaId })
        .expect(200);

      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(typeof me.body.avatarUrl).toBe('string');
      expect(me.body.avatarVariants.length).toBeGreaterThan(0);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.avatarMediaId).toBe(mediaId);
      expect(user?.avatarUrl).toBeNull();
    });

    it('rejects an asset that is not yet READY', async () => {
      const authRes = await request(app.getHttpServer())
        .post('/media/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          purpose: MediaPurpose.AVATAR,
          fileName: 'x.png',
          mimeType: 'image/png',
          fileSize: 10,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/users/me/avatar/media')
        .set('Authorization', `Bearer ${token}`)
        .send({ mediaId: authRes.body.mediaId })
        .expect(400);
    });

    it('rejects a non-AVATAR-purpose asset', async () => {
      const mediaId = await authorizeUploadConfirmAndProcess(MediaPurpose.PROOF, missionId);

      await request(app.getHttpServer())
        .post('/users/me/avatar/media')
        .set('Authorization', `Bearer ${token}`)
        .send({ mediaId })
        .expect(400);
    });

    it('replaces a previous media-pipeline avatar and cleans up the old asset', async () => {
      const firstMediaId = await authorizeUploadConfirmAndProcess(MediaPurpose.AVATAR);
      await request(app.getHttpServer())
        .post('/users/me/avatar/media')
        .set('Authorization', `Bearer ${token}`)
        .send({ mediaId: firstMediaId })
        .expect(200);

      const secondMediaId = await authorizeUploadConfirmAndProcess(MediaPurpose.AVATAR);
      await request(app.getHttpServer())
        .post('/users/me/avatar/media')
        .set('Authorization', `Bearer ${token}`)
        .send({ mediaId: secondMediaId })
        .expect(200);

      const oldAsset = await prisma.mediaAsset.findUnique({ where: { id: firstMediaId } });
      expect(oldAsset).toBeNull();

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.avatarMediaId).toBe(secondMediaId);
    });
  });

  describe('PROOF purpose authorization', () => {
    it('authorizes against a real, active mission id', async () => {
      await request(app.getHttpServer())
        .post('/media/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          purpose: MediaPurpose.PROOF,
          fileName: 'p.png',
          mimeType: 'image/png',
          fileSize: 10,
          relatedEntityId: missionId,
        })
        .expect(201);
    });

    it('returns 404 for a relatedEntityId that is not a real mission', async () => {
      await request(app.getHttpServer())
        .post('/media/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          purpose: MediaPurpose.PROOF,
          fileName: 'p.png',
          mimeType: 'image/png',
          fileSize: 10,
          relatedEntityId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });
  });
});
