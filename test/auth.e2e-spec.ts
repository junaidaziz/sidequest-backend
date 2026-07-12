import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * TODO(test-infra): these e2e tests require:
 *   1. The `add_user_refresh_token_hash` migration applied to the target DB:
 *        npx prisma migrate dev --name add_user_refresh_token_hash
 *   2. A dedicated TEST database (do not run against the dev/shared DB). Point
 *      DATABASE_URL at a throwaway schema before running `npm run test:e2e`.
 * They mirror the project's existing app.e2e-spec.ts bootstrap (real AppModule +
 * Supertest) and clean up the users they create in afterAll.
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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: createdEmail } });
    await app.close();
  });

  describe('POST /auth/guest', () => {
    it('returns a token pair with no auth', async () => {
      const res = await request(app.getHttpServer()).post('/auth/guest').expect(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });
  });

  describe('POST /auth/signup', () => {
    it('creates a full account and returns tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ email: createdEmail, password: 'password123', displayName: 'E2E' })
        .expect(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
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
    it('authenticates valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: createdEmail, password: 'password123' })
        .expect(200);
      expect(res.body).toHaveProperty('accessToken');
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
    });

    it('returns 401 for a structurally-invalid token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not.a.jwt' })
        .expect(401);
    });
  });
});
