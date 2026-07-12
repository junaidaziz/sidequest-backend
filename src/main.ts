import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestLoggingMiddleware } from './common/middleware/request-logging.middleware';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.use(requestLoggingMiddleware());

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
  // Allow-list rather than deny-list: a deployment that forgets to set
  // NODE_ENV at all fails closed (docs off) instead of accidentally public.
  const docsEnabled = ['development', 'test'].includes(process.env.NODE_ENV ?? '');
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
