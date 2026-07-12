import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

  app.use(requestLoggingMiddleware());
  // CSP disabled: this is a JSON API whose only HTML surface is the dev-only
  // Swagger UI below, which relies on inline scripts that the default CSP
  // blocks — the documented NestJS+Swagger+Helmet pattern. Every other
  // helmet protection (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
  // stays on. TODO: if an HTML route besides Swagger is ever added, scope
  // this to /docs only instead of disabling CSP globally.
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

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`SideQuest API listening on port ${port}` + (docsEnabled ? ' — docs at /docs' : ''));
}

bootstrap();
