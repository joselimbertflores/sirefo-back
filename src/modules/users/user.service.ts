import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from 'generated/prisma';

import { PaginationDto } from 'src/modules/common/dtos/pagination.dto';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dtos';
import { SiauService } from '../auth/services/siau.service';
import { UserRole } from './domain';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private siauService: SiauService,
  ) {}

  findAssignable(term?: string) {
    return this.siauService.searchAssignableUsers(term);
  }

  async create({ externalKey, position, roles }: CreateUserDto) {
    const identity = await this.siauService.findAssignableUser(externalKey);
    try {
      return await this.prisma.user.create({
        data: {
          externalKey: identity.externalKey,
          fullName: identity.fullName,
          position,
          roles: roles ?? [UserRole.EMPLOYEE],
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('El funcionario ya está registrado en SIREFO; utilice la opción de editar');
      }
      throw error;
    }
  }

  async findAll({ limit, offset, term }: PaginationDto) {
    const where: Prisma.UserWhereInput = {
      ...(term && {
        fullName: {
          contains: term,
          mode: 'insensitive',
        },
      }),
    };
    const [users, length] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, length };
  }

  async update(id: number, user: UpdateUserDto) {
    const userDB = await this.prisma.user.findFirst({ where: { id } });
    if (!userDB) throw new NotFoundException(`El usuario editado no existe`);
    return this.prisma.user.update({ where: { id }, data: user });
  }
}
