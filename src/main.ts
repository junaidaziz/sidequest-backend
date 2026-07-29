import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Express } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestLoggingMiddleware } from './common/middleware/request-logging.middleware';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Two independently-configurable gates share this NODE_ENV check today
  // (docsEnabled, corsPermissiveDefault) — they happen to agree now, but
  // each has its own env-var override (CORS_ALLOWED_ORIGINS below), so a
  // future deployment that needs one without the other (e.g. Swagger on
  // staging, CORS still locked down) only needs an env change, not code.
  const isDevOrTest = ['development', 'test'].includes(process.env.NODE_ENV ?? '');

  // Trust exactly ONE proxy hop — Railway's own edge, which fronts every request
  // into this container. With this set, Express resolves `req.ip` to the first
  // entry of the `X-Forwarded-For` header Railway's edge appends, instead of the
  // edge's own hop address. `1` (not `true`, not a larger depth) is deliberate:
  // trusting an arbitrary depth would let a direct attacker prepend a spoofed
  // `X-Forwarded-For` entry and control `req.ip`, defeating the per-IP throttle.
  // We trust exactly the one hop we actually operate.
  //
  // This alone fixes `req.ip` for traffic that arrives DIRECTLY at the edge
  // (mobile app, direct API calls, an admin browser hitting the backend through
  // nothing but Railway's edge). It does NOT fix the BFF-relay case: a request the
  // `web` app relays server-side arrives at the edge as coming from `web`'s own
  // server, so trusting Railway's edge correctly reports `web`'s IP — still not the
  // real browser's IP. That case is handled separately by TrustedIpThrottlerGuard
  // (secret-gated `x-forwarded-client-ip`), see src/common/guards.
  //
  // `1` assumes exactly one trusted hop in front of this container (Railway's own
  // edge) and that it APPENDS the real client IP to X-Forwarded-For rather than
  // passing a client-supplied header through verbatim — if that assumption is ever
  // wrong (Railway changes behavior, or a new CDN/load balancer is inserted in
  // front of Railway without updating this number), req.ip silently becomes
  // attacker-controlled and every per-IP rate limit becomes spoofable. Re-verify
  // this assumption against whatever's actually in front of the container before
  // changing deployment infrastructure.
  const expressInstance = app.getHttpAdapter().getInstance() as Express;
  expressInstance.set('trust proxy', 1);

  app.use(requestLoggingMiddleware());
  // CSP disabled: this is a JSON API whose only HTML surface is the dev-only
  // Swagger UI below, which relies on inline scripts that the default CSP
  // blocks — the documented NestJS+Swagger+Helmet pattern. Every other
  // helmet protection (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
  // stays on. If an HTML route besides Swagger is ever added, scope this to
  // /docs only instead of disabling CSP globally — deliberately not done here
  // since no such route exists yet and scoping it prematurely would just be
  // unused complexity.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Native mobile clients don't send an Origin header and are unaffected by
  // CORS either way — this exists for the Expo "web" target and any future
  // browser-based client. Allow-list rather than deny-list: an unset
  // CORS_ALLOWED_ORIGINS fails closed (no cross-origin access) in
  // production, permissive only in dev/test.
  const corsPermissiveDefault = isDevOrTest;
  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : corsPermissiveDefault,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Public API docs are a reasonable dev/staging convenience but shouldn't be
  // exposed unauthenticated in production — they enumerate every DTO shape.
  const docsEnabled = isDevOrTest;
  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SideQuest API')
      .setDescription('Real-world mission generator — backend API')
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // Without this, a container orchestrator's SIGTERM (Railway on redeploy or
  // scale-down) exits the process immediately: in-flight requests are cut at
  // the socket, Prisma's pool closes without draining open transactions, and
  // BullMQ workers abandon in-progress jobs instead of finishing or
  // releasing them cleanly.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`SideQuest API listening on port ${port}` + (docsEnabled ? ' — docs at /docs' : ''));
}

bootstrap();
