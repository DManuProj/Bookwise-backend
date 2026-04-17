import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // needed for webhooks to verify the signature
  });

  // prefix all routes with /api
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3001;

  await app.listen(port);

  // log when server starts successfully
  console.log(`
  ✅ Bookwise API is running on ${port}
  📦 Environment: ${process.env.NODE_ENV ?? 'developments'}
  `);
}
bootstrap();
