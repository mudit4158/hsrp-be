import 'reflect-metadata';
import { env } from './platform/config/env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true, cors: { origin: true, credentials: false } });
  app.setGlobalPrefix('api/v1', { exclude: ['mock-gateway/(.*)'] });
  app.enableShutdownHooks();

  patchNestJsSwagger();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('HSRP Dealer Management System API')
      .setDescription('Prototype API. Errors are RFC 7807 problem JSON. Order, payment, fitment and inward calls need an Idempotency-Key header.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'oem-api-key')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });

  await app.listen(env.port, env.host);
  new Logger('Bootstrap').log(`API on http://${env.host}:${env.port}/api/v1  ·  docs at /api/docs`);
}

void bootstrap();
