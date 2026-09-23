import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthOrigin, AuthSession, User } from 'generated/prisma';

import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../users/domain';
import { FRONTEND_MENU, Menu } from './constants';
import { AuthDto, UpdateMyUserDto } from './dto';
import { SessionService } from './services/session.service';
import { SiauService } from './services/siau.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly siauService: SiauService,
  ) {}

  async loginLocal({ login, password }: AuthDto) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (!user?.password || !bcrypt.compareSync(password, user.password)) {
      throw new UnauthorizedException('Usuario o Contraseña incorrectos');
    }
    this.ensureActive(user);

    const session = await this.sessionService.createLocal(user.id);
    return { session, account: this.buildAccount(user, AuthOrigin.LOCAL) };
  }

  startSiauLogin(): Promise<string> {
    return this.siauService.createAuthorizationUrl();
  }

  async completeSiauLogin(code: string, state: string) {
    const tokens = await this.siauService.exchangeAuthorizationCode(code, state);
    const externalKey = tokens.claims.externalKey;
    const user = await this.prisma.user.upsert({
      where: { externalKey },
      update: {},
      create: {
        externalKey,
        fullName: tokens.claims.name,
        position: null,
        login: this.buildJitLogin(externalKey),
        password: null,
        roles: [UserRole.EMPLOYEE],
      },
    });
    this.ensureActive(user);

    const session = await this.sessionService.createSiau(user.id, tokens);
    return { session, account: this.buildAccount(user, AuthOrigin.SIAU) };
  }

  getMyAccount(user: User, session: AuthSession) {
    return this.buildAccount(user, session.origin);
  }

  async updateMyUser(user: User, data: UpdateMyUserDto) {
    if (!user.password) {
      throw new BadRequestException('SIAU-only users do not have a local password');
    }
    const encryptedPassword = await this.encryptPassword(data.password);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: encryptedPassword, mustChangePassword: false },
    });
    return { message: 'Contraseña actualizada' };
  }

  private buildAccount(user: User, origin: AuthOrigin) {
    return {
      user: {
        userId: user.id,
        fullName: user.fullName,
        position: user.position,
      },
      roles: user.roles,
      menu: this.getFrontMenu(user.roles as UserRole[]),
      mustChangePassword: origin === AuthOrigin.LOCAL && user.mustChangePassword,
      authOrigin: origin,
    };
  }

  private ensureActive(user: User): void {
    if (!user.active) throw new UnauthorizedException('La cuenta ha sido deshabilitada');
  }

  private buildJitLogin(externalKey: string): string {
    const digest = createHash('sha256').update(externalKey).digest('hex').slice(0, 32);
    return `siau_${digest}`;
  }

  private getFrontMenu(roles: UserRole[]): Menu[] {
    return this.filterMenuByRoles(structuredClone(FRONTEND_MENU), roles);
  }

  private filterMenuByRoles(menu: Menu[], userRoles: UserRole[]): Menu[] {
    return menu
      .map((item) => {
        if (item.items) {
          const items = this.filterMenuByRoles(item.items, userRoles);
          return items.length > 0 ? { ...item, items } : null;
        }
        return !item.role || userRoles.includes(item.role) ? item : null;
      })
      .filter((item): item is Menu => item !== null);
  }

  private async encryptPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }
}
