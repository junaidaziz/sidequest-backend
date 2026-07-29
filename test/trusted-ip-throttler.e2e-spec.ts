import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * End-to-end coverage for the secret-gated trusted-forward throttling path
 * (TrustedIpThrottlerGuard). Exercised through POST /auth/forgot-password, which
 * is a public, tightly-throttled (5/60s), always-200 endpoint that has no side
 * effects for an unknown email — so it can be hammered without seeding or
 * cleaning up any fixtures.
 *
 * `INTERNAL_PROXY_SECRET` is set on the process env below BEFORE the Nest module
 * is compiled, so the guard picks it up in its constructor (dotenv does not
 * override an already-set process.env value, so this wins over any local .env).
 *
 * Requires the local dev database + Redis to be up (shared throttler store), the
 * same as every other e2e suite. The suite resets throttle state before each case
 * so the per-tracker-key counters start clean.
 */
describe('Trusted-IP throttling (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const SECRET = `e2e-internal-proxy-secret-${Date.now()}`;
  const suffix = Date.now();
  // Distinct documentation-range IPs (RFC 5737 / RFC 3849) per scenario.
  const IP_A = '203.0.113.11';
  const IP_B = '203.0.113.22';
  const IP_SPOOF = '203.0.113.33';

  // SENSITIVE_THROTTLE on POST /auth/forgot-password (see auth.controller.ts).
  const LIMIT = 5;

  function forgotPassword(headers: Record<string, string> = {}) {
    const req = request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: `e2e-throttle-unknown-${suffix}@example.com` });
    for (const [key, value] of Object.entries(headers)) {
      req.set(key, value);
    }
    return req;
  }

  beforeAll(async () => {
    process.env.INTERNAL_PROXY_SECRET = SECRET;

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
  });

  afterAll(async () => {
    delete process.env.INTERNAL_PROXY_SECRET;
    await app.close();
  });

  it('meters a trusted forward by the forwarded client IP, isolated per IP', async () => {
    await resetThrottleState(app);

    // Exhaust the budget for forwarded IP_A.
    for (let i = 0; i < LIMIT; i++) {
      await forgotPassword({
        'x-internal-proxy-secret': SECRET,
        'x-forwarded-client-ip': IP_A,
      }).expect(200);
    }
    // One more from IP_A trips the per-IP limit.
    await forgotPassword({
      'x-internal-proxy-secret': SECRET,
      'x-forwarded-client-ip': IP_A,
    }).expect(429);

    // A different forwarded IP has its own fresh budget — proving the tracker key
    // is the forwarded IP, not the shared real (loopback) req.ip.
    await forgotPassword({
      'x-internal-proxy-secret': SECRET,
      'x-forwarded-client-ip': IP_B,
    }).expect(200);
  });

  it('ignores a spoofed forwarded IP without the secret and meters by real req.ip', async () => {
    await resetThrottleState(app);

    // Fill the real-req.ip (loopback) budget with plain, header-less requests.
    for (let i = 0; i < LIMIT; i++) {
      await forgotPassword().expect(200);
    }

    // A request that spoofs x-forwarded-client-ip but has NO secret must NOT get a
    // fresh budget — it is still counted against the (now-exhausted) real req.ip.
    await forgotPassword({ 'x-forwarded-client-ip': IP_SPOOF }).expect(429);

    // Same story with a WRONG secret: the forward is ignored, real req.ip applies.
    await forgotPassword({
      'x-internal-proxy-secret': 'wrong-secret',
      'x-forwarded-client-ip': IP_SPOOF,
    }).expect(429);
  });

  it('keeps prisma reachable (smoke) so the suite fails loudly if wiring breaks', () => {
    // The guard is a pure request-layer concern; this just asserts the app booted
    // with a live PrismaService rather than a half-initialised context.
    expect(prisma).toBeDefined();
  });
});
