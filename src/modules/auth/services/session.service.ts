import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthOrigin, AuthSession, User } from 'generated/prisma';

import { EnvVars } from 'src/config';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { SiauTokenSet } from '../interfaces';
import { SiauService } from './siau.service';

export type AuthenticatedSession = AuthSession & { user: User };

@Injectable()
export class SessionService {
  private readonly sessionTtlMilliseconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly siauService: SiauService,
    configService: ConfigService<EnvVars>,
  ) {
    this.sessionTtlMilliseconds = (configService.get('SESSION_TTL_SECONDS') ?? 28_800) * 1000;
  }

  get sessionTtl(): number {
    return this.sessionTtlMilliseconds;
  }

  async createLocal(userId: number): Promise<AuthSession> {
    return this.prisma.authSession.create({
      data: {
        id: this.generateSessionId(),
        userId,
        origin: AuthOrigin.LOCAL,
        expiresAt: this.getSessionExpiration(),
      },
    });
  }

  async createSiau(userId: number, tokens: SiauTokenSet): Promise<AuthSession> {
    return this.prisma.authSession.create({
      data: {
        id: this.generateSessionId(),
        userId,
        origin: AuthOrigin.SIAU,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        siauSid: tokens.claims.sid,
        expiresAt: this.getSessionExpiration(),
      },
    });
  }

  async authenticate(sessionId: string): Promise<AuthenticatedSession> {
    let session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || session.expiresAt <= new Date() || !session.user.active) {
      if (session) await this.destroy(session.id);
      throw new UnauthorizedException();
    }

    if (
      session.origin === AuthOrigin.SIAU &&
      (!session.accessTokenExpiresAt || session.accessTokenExpiresAt.getTime() <= Date.now() + 30_000)
    ) {
      session = await this.refreshSiauSession(session.id);
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    return session;
  }

  async destroy(sessionId: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { id: sessionId } });
  }

  private async refreshSiauSession(sessionId: string): Promise<AuthenticatedSession> {
    const session = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`;
        const current = await tx.authSession.findUnique({
          where: { id: sessionId },
          include: { user: true },
        });

        if (!current) return null;
        if (current.origin !== AuthOrigin.SIAU || current.expiresAt <= new Date() || !current.user.active) {
          await tx.authSession.delete({ where: { id: sessionId } });
          return null;
        }

        if (current.accessTokenExpiresAt && current.accessTokenExpiresAt.getTime() > Date.now() + 30_000) {
          return current;
        }
        if (!current.refreshToken || (current.refreshTokenExpiresAt && current.refreshTokenExpiresAt <= new Date())) {
          await tx.authSession.delete({ where: { id: sessionId } });
          return null;
        }

        const tokens = await this.siauService.refresh(current.refreshToken);
        if (tokens.claims.externalKey !== current.user.externalKey) {
          await tx.authSession.delete({ where: { id: sessionId } });
          return null;
        }

        return tx.authSession.update({
          where: { id: sessionId },
          data: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? current.refreshToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? current.refreshTokenExpiresAt,
            siauSid: tokens.claims.sid,
          },
          include: { user: true },
        });
      },
      { timeout: 15_000 },
    );

    if (!session) throw new UnauthorizedException('SIAU session can no longer be refreshed');
    return session;
  }

  private generateSessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  private getSessionExpiration(): Date {
    return new Date(Date.now() + this.sessionTtlMilliseconds);
  }
}
