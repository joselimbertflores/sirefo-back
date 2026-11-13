import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AuthOrigin, AuthSession, User } from 'generated/prisma';

import { EnvVars } from 'src/config';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { SiauService } from './siau.service';

export type AuthenticatedSession = AuthSession & { user: User };

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessionTtlMilliseconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly siauService: SiauService,
    configService: ConfigService<EnvVars>,
  ) {
    this.sessionTtlMilliseconds = (configService.get('SESSION_TTL_SECONDS') ?? 36_000) * 1000;
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

  async createSiau(userId: number, sid: string): Promise<AuthSession> {
    return this.prisma.authSession.create({
      data: {
        id: this.generateSessionId(),
        userId,
        origin: AuthOrigin.SIAU,
        siauSid: sid,
        expiresAt: this.getSessionExpiration(),
      },
    });
  }

  async authenticate(sessionId: string): Promise<AuthenticatedSession> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) await this.destroy(session.id);
      throw new UnauthorizedException();
    }

    const updated = await this.prisma.authSession.updateMany({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    if (updated.count === 0) throw new UnauthorizedException();
    return session;
  }

  async destroy(sessionId: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { id: sessionId } });
  }

  async logout(sessionId: string): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { origin: true, siauSid: true },
    });

    await this.destroy(sessionId);

    if (session?.origin === AuthOrigin.SIAU && session.siauSid) {
      void this.siauService.notifyLogout(session.siauSid).catch(() => {
        this.logger.warn('SIAU logout notification failed; the local session is already closed');
      });
    }
  }

  async destroySiauSessionsBySid(sid: string): Promise<void> {
    await this.prisma.authSession.deleteMany({
      where: { origin: AuthOrigin.SIAU, siauSid: sid },
    });
  }

  private generateSessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  private getSessionExpiration(): Date {
    return new Date(Date.now() + this.sessionTtlMilliseconds);
  }
}
