import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/modules/prisma/prisma.service';

import { CryptoService } from './crypto.service';
import { AsfiCredentialsDto } from '../dtos';

@Injectable()
export class AsfiCrendentialsService {
  constructor(
    private prisma: PrismaService,
    private cryptoService: CryptoService,
  ) {}

  async resetCredentials(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('El usuario seleccionado no existe');
    await this.prisma.asfiCredentials.deleteMany({ where: { userId } });
    return { message: 'Credenciales ASFI restablecidas en SIREFO' };
  }

  async setCredentials(userId: number, { asfiPassword, asfiUsername }: AsfiCredentialsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { asfiCredentials: true },
    });

    const { encryptedData, iv } = this.cryptoService.encrypt(asfiPassword);

    if (user.asfiCredentials) {
      await this.prisma.asfiCredentials.update({
        where: { userId },
        data: {
          asfiUsername,
          asfiPassword: encryptedData,
          passwordIv: iv,
        },
      });
    } else {
      await this.prisma.asfiCredentials.create({
        data: {
          userId,
          asfiUsername,
          asfiPassword: encryptedData,
          passwordIv: iv,
        },
      });
    }
    return { message: 'Credentials done', email: asfiUsername };
  }
}
