import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api');
  const publicOrigin = new URL(configService.getOrThrow<string>('SIREFO_PUBLIC_URL')).origin;
  const uiUrl = configService.get<string>('SIREFO_UI_URL');
  if (uiUrl) {
    const uiOrigin = new URL(uiUrl).origin;
    if (uiOrigin !== publicOrigin) app.enableCors({ origin: uiOrigin, credentials: true });
  }
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
