import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { OAuthController } from './oauth.controller';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './guards';
import { SessionService } from './services/session.service';
import { SiauService } from './services/siau.service';

@Module({
  controllers: [AuthController, OAuthController],
  imports: [PrismaModule],
  providers: [
    AuthService,
    SiauService,
    SessionService,
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
  ],
  exports: [SiauService],
})
export class AuthModule {}
