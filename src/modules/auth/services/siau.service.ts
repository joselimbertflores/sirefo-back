import { BadGatewayException, BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, errors, jwtVerify, RemoteJWKSet } from 'jose';

import { EnvVars } from 'src/config';
import { PrismaService } from 'src/modules/prisma/prisma.service';
import { SiauAccessTokenClaims, SiauTokenResponse, SiauTokenSet } from '../interfaces';

@Injectable()
export class SiauService {
  private readonly publicUrl: string;
  private readonly internalUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly jwks: RemoteJWKSet;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService<EnvVars>,
  ) {
    const sirefoPublicUrl = configService.getOrThrow('SIREFO_PUBLIC_URL').replace(/\/+$/, '');
    this.publicUrl = configService.getOrThrow('IDENTITY_HUB_PUBLIC_URL').replace(/\/+$/, '');
    this.internalUrl = (configService.get('IDENTITY_HUB_INTERNAL_URL') ?? this.publicUrl).replace(/\/+$/, '');
    this.clientId = configService.getOrThrow('OAUTH_CLIENT_ID');
    this.clientSecret = configService.getOrThrow('OAUTH_CLIENT_SECRET');
    this.redirectUri = `${sirefoPublicUrl}/api/auth/siau/callback`;
    this.jwks = createRemoteJWKSet(new URL(`${this.internalUrl}/.well-known/jwks.json`));
  }

  async createAuthorizationUrl(): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.oAuthTransaction.deleteMany({ where: { expiresAt: { lte: now } } }),
      this.prisma.oAuthTransaction.create({
        data: {
          state,
          codeVerifier,
          expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        },
      }),
    ]);

    const authorizationUrl = new URL(`${this.publicUrl}/oauth/authorize`);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', this.clientId);
    authorizationUrl.searchParams.set('redirect_uri', this.redirectUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    return authorizationUrl.toString();
  }

  async exchangeAuthorizationCode(code: string, state: string): Promise<SiauTokenSet> {
    const codeVerifier = await this.consumeTransaction(state);
    return this.requestTokens(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      }),
    );
  }

  async refresh(refreshToken: string): Promise<SiauTokenSet> {
    return this.requestTokens(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    );
  }

  private async consumeTransaction(state: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.oAuthTransaction.findUnique({ where: { state } });
      if (!transaction || transaction.expiresAt <= new Date()) {
        throw new BadRequestException('Invalid or expired OAuth state');
      }

      const deleted = await tx.oAuthTransaction.deleteMany({
        where: { state, expiresAt: { gt: new Date() } },
      });
      if (deleted.count !== 1) throw new BadRequestException('OAuth state has already been used');
      return transaction.codeVerifier;
    });
  }

  private async requestTokens(body: URLSearchParams): Promise<SiauTokenSet> {
    let response: SiauTokenResponse;
    try {
      const basicCredentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const result = await axios.post<SiauTokenResponse>(`${this.internalUrl}/oauth/token`, body.toString(), {
        headers: {
          Authorization: `Basic ${basicCredentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10_000,
      });
      response = result.data;
    } catch {
      throw new BadGatewayException('SIAU token exchange failed');
    }

    if (typeof response?.access_token !== 'string' || !response.access_token) {
      throw new BadGatewayException('SIAU did not return an access token');
    }
    const claims = await this.validateAccessToken(response.access_token);
    const refreshTokenExpiresAt = response.refresh_expires_in
      ? new Date(Date.now() + response.refresh_expires_in * 1000)
      : null;

    return {
      accessToken: response.access_token,
      refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : null,
      accessTokenExpiresAt: new Date(claims.exp * 1000),
      refreshTokenExpiresAt,
      claims,
    };
  }

  private async validateAccessToken(token: string): Promise<SiauAccessTokenClaims> {
    let claims: SiauAccessTokenClaims;
    try {
      ({ payload: claims } = await jwtVerify<SiauAccessTokenClaims>(token, this.jwks, {
        algorithms: ['RS256'],
        issuer: this.publicUrl,
        audience: this.clientId,
        requiredClaims: ['exp'],
      }));
    } catch (error) {
      if (
        error instanceof errors.JWKSTimeout ||
        error instanceof errors.JWKInvalid ||
        error instanceof errors.JWKSInvalid ||
        (error instanceof errors.JOSEError && error.constructor === errors.JOSEError) ||
        (error instanceof TypeError && 'cause' in error && error.cause instanceof Error)
      ) {
        throw new BadGatewayException('Could not validate SIAU access token');
      }
      if (error instanceof errors.JOSEError) {
        throw new UnauthorizedException('Invalid SIAU access token');
      }
      throw error;
    }

    if (
      typeof claims.externalKey !== 'string' ||
      !claims.externalKey.trim() ||
      typeof claims.name !== 'string' ||
      !claims.name.trim() ||
      typeof claims.sid !== 'string' ||
      !claims.sid.trim()
    ) {
      throw new UnauthorizedException('Missing required SIAU token claims');
    }
    return {
      exp: claims.exp,
      externalKey: claims.externalKey.trim(),
      name: claims.name.trim(),
      sid: claims.sid.trim(),
    };
  }
}
