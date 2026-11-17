import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  controllers: [UserController],
  providers: [UserService],
  imports: [PrismaModule, AuthModule],
  exports: [UserService],
})
export class UsersModule {}
