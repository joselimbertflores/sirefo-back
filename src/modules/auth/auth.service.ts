import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, User } from 'generated/prisma';

import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../users/domain';
import { FRONTEND_MENU, Menu } from './constants';
import { SessionService } from './services/session.service';
import { SiauService } from './services/siau.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly siauService: SiauService,
  ) {}

  async completeSiauLogin(code: string, transaction: { codeVerifier: string; nonce: string }) {
    const identity = await this.siauService.exchangeAuthorizationCode(
      code,
      transaction.codeVerifier,
      transaction.nonce,
    );
    const externalKey = identity.externalKey;
    if (typeof externalKey !== 'string' || !externalKey.trim()) {
      throw new UnauthorizedException('Invalid SIAU externalKey');
    }
    const fullName = identity.name;
    let user = await this.prisma.user.findUnique({ where: { externalKey } });

    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            externalKey,
            fullName,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        user = await this.prisma.user.findUnique({ where: { externalKey } });
        if (!user) throw error;
      }
    }

    const session = await this.sessionService.createSiau(user.id, identity.sid);
    return { session, account: this.getMyAccount(user) };
  }

  getMyAccount(user: User) {
    return {
      user: {
        userId: user.id,
        fullName: user.fullName,
        position: user.position,
      },
      roles: user.roles,
      menu: this.getFrontMenu(user.roles as UserRole[]),
    };
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
}
