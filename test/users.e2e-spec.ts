import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { StorageService } from './../src/storage/storage.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev Postgres (docker-compose) AND real LocalStack S3
 * (bucket sidequest-proofs-dev) — the avatar happy path uploads a real buffer
 * and GETs the returned presigned URL to prove the object round-trips through
 * LocalStack, and the replace/delete paths prove the old object is actually
 * removed. TODO(test-infra): move to a throwaway test DB once one exists —
 * see backend/CLAUDE.md.
 */
describe('Users profile + avatar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  const createdUserIds: string[] = [];

  // 1x1 transparent PNG.
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  let avatarToken: string;
  let avatarUserId: string;
  let profileToken: string;

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
    storage = app.get(StorageService);
    await app.init();
    await resetThrottleState(app);

    const avatarGuest = await createGuest();
    avatarToken = avatarGuest.token;
    avatarUserId = avatarGuest.userId;

    const profileGuest = await createGuest();
    profileToken = profileGuest.token;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  describe('PATCH /auth/me', () => {
    it('updates the display name and returns the resolved profile', async () => {
      const res = await request(app.getHttpServer())
        .patch('/auth/me')
        .set('Authorization', `Bearer ${profileToken}`)
        .send({ displayName: 'Explorer' })
        .expect(200);

      expect(res.body).toMatchObject({ displayName: 'Explorer', isGuest: true });
      expect(res.body.avatarUrl).toBeNull();
    });

    it('rejects an empty display name with 400', async () => {
      await request(app.getHttpServer())
        .patch('/auth/me')
        .set('Authorization', `Bearer ${profileToken}`)
        .send({ displayName: '' })
        .expect(400);
    });

    it('rejects a display name longer than 50 characters with 400', async () => {
      await request(app.getHttpServer())
        .patch('/auth/me')
        .set('Authorization', `Bearer ${profileToken}`)
        .send({ displayName: 'x'.repeat(51) })
        .expect(400);
    });

    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer())
        .patch('/auth/me')
        .send({ displayName: 'NoAuth' })
        .expect(401);
    });
  });

  describe('POST /users/me/avatar', () => {
    it('uploads a real image to LocalStack and returns a working presigned avatarUrl', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${avatarToken}`)
        .attach('avatar', pngBuffer, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(200);

      expect(typeof res.body.avatarUrl).toBe('string');

      const download = await fetch(res.body.avatarUrl);
      expect(download.status).toBe(200);
      const downloaded = Buffer.from(await download.arrayBuffer());
      expect(downloaded.equals(pngBuffer)).toBe(true);

      // The row stores an S3 key under avatars/, not a URL.
      const user = await prisma.user.findUnique({ where: { id: avatarUserId } });
      expect(user?.avatarUrl).toMatch(/^avatars\/.+\.png$/);
    });

    it('replaces the avatar and deletes the previous object', async () => {
      const before = await prisma.user.findUnique({ where: { id: avatarUserId } });
      const oldKey = before?.avatarUrl as string;
      expect(oldKey).toMatch(/^avatars\//);

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${avatarToken}`)
        .attach('avatar', pngBuffer, { filename: 'avatar2.png', contentType: 'image/png' })
        .expect(200);

      const after = await prisma.user.findUnique({ where: { id: avatarUserId } });
      expect(after?.avatarUrl).not.toBe(oldKey);

      // The previous object is gone from LocalStack.
      const oldUrl = await storage.getSignedDownloadUrl(oldKey);
      const oldDownload = await fetch(oldUrl);
      expect(oldDownload.status).not.toBe(200);
    });

    it('rejects an unsupported image type with 400', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${avatarToken}`)
        .attach('avatar', Buffer.from('gif'), { filename: 'a.gif', contentType: 'image/gif' })
        .expect(400);
    });

    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .attach('avatar', pngBuffer, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(401);
    });
  });

  describe('DELETE /users/me/avatar', () => {
    it('removes the avatar and nulls avatarUrl', async () => {
      const before = await prisma.user.findUnique({ where: { id: avatarUserId } });
      const key = before?.avatarUrl as string;
      expect(key).toMatch(/^avatars\//);

      const res = await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${avatarToken}`)
        .expect(200);

      expect(res.body.avatarUrl).toBeNull();

      const after = await prisma.user.findUnique({ where: { id: avatarUserId } });
      expect(after?.avatarUrl).toBeNull();

      const url = await storage.getSignedDownloadUrl(key);
      const download = await fetch(url);
      expect(download.status).not.toBe(200);
    });

    it('is idempotent — deleting again with no avatar still returns 200 and null', async () => {
      const res = await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${avatarToken}`)
        .expect(200);

      expect(res.body.avatarUrl).toBeNull();
    });

    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer()).delete('/users/me/avatar').expect(401);
    });
  });
});
