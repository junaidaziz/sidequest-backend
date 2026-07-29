import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { EmailService } from './../src/email/email.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { RedisService } from './../src/redis/redis.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Consumer password-reset flow e2e (closed-beta admin tooling). Runs against the
 * local dev DB + Redis. The emailed reset link is captured by spying on
 * EmailService (the dev/test provider is a no-op that never actually sends), so
 * the raw token can be extracted and fed back into POST /auth/reset-password.
 *
 * No new migration is required for this suite — it uses the existing User table
 * plus Redis for the reset-token store.
 */
describe('Consumer password reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: EmailService;

  const suffix = Date.now();
  const userEmail = `e2e-pwreset-${suffix}@example.com`;
  const originalPassword = 'original-password';

  async function forgotAndCaptureToken(target: string): Promise<string | null> {
    const spy = jest.spyOn(email, 'sendPasswordReset').mockResolvedValue({ status: 'ok' });
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: target })
      .expect(200);
    const url = spy.mock.calls[0]?.[1];
    spy.mockRestore();
    if (!url) {
      return null;
    }
    return url.split('token=')[1] ?? null;
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
    email = app.get(EmailService);
    await app.init();
    await resetThrottleState(app);

    // A real password account to reset.
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: userEmail, password: originalPassword })
      .expect(201);
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (user) {
      await app.get(RedisService).del(`user:pwreset:${user.id}`);
    }
    await prisma.user.deleteMany({ where: { email: userEmail } });
    await app.close();
  });

  it('always returns 200 for an unknown email without sending an email', async () => {
    const spy = jest.spyOn(email, 'sendPasswordReset');
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: `nobody-${suffix}@example.com` })
      .expect(200)
      .expect((res) => expect(res.body).toEqual({ success: true }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects a malformed email with 400', async () => {
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('rejects an invalid reset token with 400', async () => {
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: 'bogus.token', newPassword: 'brand-new-pass' })
      .expect(400);
  });

  it('completes a full forgot -> reset -> login-with-new-password round trip', async () => {
    const token = await forgotAndCaptureToken(userEmail);
    expect(token).toBeTruthy();
    expect(
      token?.startsWith((await prisma.user.findUnique({ where: { email: userEmail } }))!.id),
    ).toBe(true);

    const newPassword = 'my-fresh-s3cret';
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, newPassword })
      .expect(200)
      .expect((res) => expect(res.body).toEqual({ success: true }));

    // Old password no longer works.
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: originalPassword })
      .expect(401);

    // New password works.
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: newPassword })
      .expect(200);
  });

  it('rejects reusing a token that was already consumed', async () => {
    const token = await forgotAndCaptureToken(userEmail);
    expect(token).toBeTruthy();

    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, newPassword: 'another-new-pass' })
      .expect(200);

    // Second use of the same (now-consumed) token is a 400.
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, newPassword: 'yet-another-pass' })
      .expect(400);
  });
});
