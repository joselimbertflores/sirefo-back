import { BadGatewayException, BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, errors, jwtVerify, RemoteJWKSet } from 'jose';

import { EnvVars } from 'src/config';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { OAUTH_TRANSACTION_TTL_MS } from '../constants';
import { SiauIdentity } from '../interfaces';

@Injectable()
export class SiauService {
  private static readonly BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

  private readonly publicUrl: string;
  private readonly internalUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenAuthorization: string;
  private readonly redirectUri: string;
  private readonly jwks: RemoteJWKSet;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService<EnvVars>,
  ) {
    const sirefoPublicUrl = configService.getOrThrow('SIREFO_PUBLIC_URL').replace(/\/+$/, '');
    this.publicUrl = configService.getOrThrow('IDENTITY_HUB_PUBLIC_URL');
    this.internalUrl = (configService.get('IDENTITY_HUB_INTERNAL_URL') ?? this.publicUrl).replace(/\/+$/, '');
    this.clientId = configService.getOrThrow('OAUTH_CLIENT_ID');
    this.clientSecret = configService.getOrThrow('OAUTH_CLIENT_SECRET');
    const credentials = [this.clientId, this.clientSecret]
      .map((value) => new URLSearchParams({ value }).toString().slice('value='.length))
      .join(':');
    this.tokenAuthorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    this.redirectUri = `${sirefoPublicUrl}/auth/callback`;
    this.jwks = createRemoteJWKSet(new URL(`${this.internalUrl}/.well-known/jwks.json`));
  }

  async createAuthorizationUrl(): Promise<{ url: string; transactionId: string }> {
    const transactionId = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.oAuthTransaction.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.oAuthTransaction.create({
        data: {
          id: transactionId,
          state: createHash('sha256').update(state).digest('hex'),
          nonce,
          codeVerifier,
          expiresAt: new Date(now.getTime() + OAUTH_TRANSACTION_TTL_MS),
        },
      }),
    ]);

    const authorizationUrl = new URL(`${this.publicUrl.replace(/\/+$/, '')}/oauth/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      scope: 'openid',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return { url: authorizationUrl.toString(), transactionId };
  }

  async consumeTransaction(transactionId: string, state?: string) {
    if (!transactionId || !state) throw new BadRequestException('Missing OAuth transaction or state');
    const where = {
      id: transactionId,
      state: createHash('sha256').update(state).digest('hex'),
      expiresAt: { gt: new Date() },
    };

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.oAuthTransaction.findUnique({ where });
      if (!transaction) {
        throw new BadRequestException('Invalid or expired OAuth state');
      }
      const deleted = await tx.oAuthTransaction.deleteMany({ where });
      if (deleted.count !== 1) throw new BadRequestException('OAuth state has already been used');
      return { codeVerifier: transaction.codeVerifier, nonce: transaction.nonce };
    });
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string, nonce: string): Promise<SiauIdentity> {
    let response: { id_token?: unknown };
    try {
      const result = await axios.post<{ id_token?: unknown }>(
        `${this.internalUrl}/oauth/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
        {
          headers: {
            Authorization: this.tokenAuthorization,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10_000,
        },
      );
      response = result.data;
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        error.response?.status === 400 &&
        error.response.data?.error === 'invalid_grant'
      ) {
        throw new UnauthorizedException('SIAU rejected the authorization code');
      }
      throw new BadGatewayException('SIAU token exchange failed');
    }

    if (typeof response?.id_token !== 'string' || !response.id_token) {
      throw new BadGatewayException('SIAU did not return an ID token');
    }
    const claims = await this.verifyToken(response.id_token);
    if (
      claims.nonce !== nonce ||
      typeof claims.sub !== 'string' ||
      !claims.sub.trim() ||
      typeof claims.externalKey !== 'string' ||
      !claims.externalKey.trim() ||
      typeof claims.name !== 'string' ||
      !claims.name.trim() ||
      typeof claims.sid !== 'string' ||
      !claims.sid.trim()
    ) {
      throw new UnauthorizedException('Invalid SIAU ID token claims');
    }
    return { sub: claims.sub, externalKey: claims.externalKey, name: claims.name, sid: claims.sid };
  }

  async notifyLogout(sid: string): Promise<void> {
    try {
      await axios.post(
        `${this.internalUrl}/internal/sessions/logout`,
        { sid },
        {
          // SIAU's internal endpoint currently reads literal Basic credentials.
          auth: { username: this.clientId, password: this.clientSecret },
          timeout: 10_000,
        },
      );
    } catch {
      throw new BadGatewayException('SIAU session logout notification failed');
    }
  }

  async validateLogoutToken(token: string): Promise<string> {
    const payload = await this.verifyToken(token, 'logout+jwt');
    const events = payload.events;
    if (
      typeof payload.jti !== 'string' ||
      !payload.jti.trim() ||
      typeof payload.sid !== 'string' ||
      !payload.sid.trim() ||
      typeof events !== 'object' ||
      events === null ||
      Array.isArray(events) ||
      Object.prototype.hasOwnProperty.call(payload, 'nonce')
    ) {
      throw new UnauthorizedException('Invalid SIAU logout token');
    }
    const event: unknown = (events as Record<string, unknown>)[SiauService.BACKCHANNEL_LOGOUT_EVENT];
    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      throw new UnauthorizedException('Invalid SIAU back-channel logout event');
    }
    return payload.sid;
  }

  private async verifyToken(token: string, typ?: 'logout+jwt') {
    try {
      const { payload } = await jwtVerify(
        token,
        (header, jwt) => {
          if (typeof header.kid !== 'string' || !header.kid.trim()) {
            throw new UnauthorizedException('Missing SIAU signing key ID');
          }
          return this.jwks(header, jwt);
        },
        {
          algorithms: ['RS256'],
          issuer: this.publicUrl,
          audience: this.clientId,
          requiredClaims: ['iat', 'exp'],
          maxTokenAge: '15m',
          clockTolerance: 60,
          typ,
        },
      );
      if (
        typeof payload.aud !== 'string' ||
        !Number.isInteger(payload.iat) ||
        payload.iat <= 0 ||
        !Number.isInteger(payload.exp) ||
        payload.exp <= payload.iat
      ) {
        throw new UnauthorizedException('Invalid SIAU token claims');
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      if (
        error instanceof errors.JOSEError &&
        !(error instanceof errors.JWKSTimeout) &&
        !(error instanceof errors.JWKInvalid) &&
        !(error instanceof errors.JWKSInvalid) &&
        error.constructor !== errors.JOSEError
      ) {
        throw new UnauthorizedException('Invalid SIAU token');
      }
      throw new BadGatewayException('Could not validate SIAU token');
    }
  }
}
