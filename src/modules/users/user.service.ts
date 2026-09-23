import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma, User } from 'generated/prisma';
import * as bcrypt from 'bcrypt';

import { PaginationDto } from 'src/modules/common/dtos/pagination.dto';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dtos';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

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
    return { users: users.map((user) => this.plainUser(user)), length };
  }

  async create({ password, ...props }: CreateUserDto) {
    await this.checkDuplicateLogin(props.login);
    const encryptedPassword = await this.encryptPassword(password);
    const createdUser = await this.prisma.user.create({
      data: { ...props, password: encryptedPassword },
    });
    return this.plainUser(createdUser);
  }

  async update(id: number, user: UpdateUserDto) {
    const userDB = await this.prisma.user.findFirst({ where: { id } });
    if (!userDB) throw new NotFoundException(`El usuario editado no existe`);
    if (user.login !== undefined && user.login !== userDB.login) await this.checkDuplicateLogin(user.login);
    if (user.password) user['password'] = await this.encryptPassword(user.password);
    const updateduser = await this.prisma.user.update({ where: { id }, data: user });
    return this.plainUser(updateduser);
  }

  private async checkDuplicateLogin(login: string): Promise<void> {
    const duplicate = await this.prisma.user.findFirst({ where: { login } });
    if (duplicate) {
      throw new BadRequestException(`El login ${login} ya existe`);
    }
  }

  private async encryptPassword(password: string): Promise<string> {
    const saltRounds = 10;
    const salt = await bcrypt.genSalt(saltRounds);
    return bcrypt.hash(password, salt);
  }

  private plainUser(user: User) {
    delete user.password;
    return user;
  }
}
