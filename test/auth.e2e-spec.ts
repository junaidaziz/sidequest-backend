import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (via docker-compose) for now, cleaning
 * up the users it creates in afterAll. TODO(test-infra): move to a dedicated
 * throwaway test database/schema once one exists — see backend/CLAUDE.md.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmail = `e2e-${Date.now()}@example.com`;

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
    // Isolate this suite's rate-limit tiers from state left in shared Redis by
    // other suites/prior runs — see resetThrottleState.
    await resetThrottleState(app);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: createdEmail } });
    await app.close();
  });

  describe('POST /auth/guest', () => {
    it('returns a token pair and guest profile with no auth', async () => {
      const res = await request(app.getHttpServer()).post('/auth/guest').expect(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      // The mobile client persists tokens and session state from this single
      // response — a missing `user` here breaks hydration silently.
      expect(res.body.user).toMatchObject({ email: null, isGuest: true });
    });
  });

  describe('POST /auth/signup', () => {
    it('creates a full account and returns tokens plus the account profile', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ email: createdEmail, password: 'password123', displayName: 'E2E' })
        .expect(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toMatchObject({
        email: createdEmail,
        displayName: 'E2E',
        isGuest: false,
      });
    });

    it('rejects a duplicate email with 409', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ email: createdEmail, password: 'password123' })
        .expect(409);
    });

    it('rejects a malformed body with 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ email: 'not-an-email', password: 'short' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('authenticates valid credentials and returns the account profile', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: createdEmail, password: 'password123' })
        .expect(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user).toMatchObject({ email: createdEmail, isGuest: false });
    });

    it('returns 401 on wrong password without leaking existence', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: createdEmail, password: 'wrong-password' })
        .expect(401);
    });

    it('returns the same 401 for an unknown email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ghost@example.com', password: 'password123' })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('returns the profile for a valid access token', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: createdEmail, password: 'password123' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ email: createdEmail, isGuest: false });
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('refreshTokenHash');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates a valid refresh token', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: createdEmail, password: 'password123' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toMatchObject({ email: createdEmail, isGuest: false });
    });

    it('returns 401 for a structurally-invalid token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not.a.jwt' })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer()).post('/auth/logout').expect(401);
    });

    it('revokes the server-side refresh token so the old token can no longer refresh', async () => {
      // Use a fresh guest session (guest throttle tier) rather than another
      // /auth/login, so this suite does not exceed the tighter login tier.
      const guest = await request(app.getHttpServer()).post('/auth/guest').expect(201);

      // The captured refresh token works before logout.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: guest.body.refreshToken })
        .expect(200);

      // A fresh login/guest rotates the hash, so re-fetch a usable pair to log out.
      const guest2 = await request(app.getHttpServer()).post('/auth/guest').expect(201);

      const logout = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${guest2.body.accessToken}`)
        .expect(200);
      expect(logout.body).toEqual({ success: true });

      // The now-orphaned refresh token is rejected.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: guest2.body.refreshToken })
        .expect(401);
    });
  });
});
