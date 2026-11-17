import { BadGatewayException, BadRequestException, Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { Prisma } from 'generated/prisma';

import { EnvVars } from 'src/config';
import { AuthService } from './auth.service';
import {
  getSessionCookieOptions,
  OAUTH_TRANSACTION_COOKIE_NAME,
  OAUTH_TRANSACTION_COOKIE_PATH,
  OAUTH_TRANSACTION_TTL_MS,
  SESSION_COOKIE_NAME,
  readSessionCookie,
} from './constants';
import { SiauCallbackDto } from './dto';
import { Public } from './decorators';
import { SessionService } from './services/session.service';
import { SiauService } from './services/siau.service';

@Controller('auth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);
  private readonly cookieOptions: CookieOptions;
  private readonly transactionCookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly siauService: SiauService,
    private readonly configService: ConfigService<EnvVars>,
  ) {
    this.cookieOptions = getSessionCookieOptions(
      configService.getOrThrow('SIREFO_PUBLIC_URL'),
      configService.get('NODE_ENV'),
    );
    this.transactionCookieOptions = { ...this.cookieOptions, path: OAUTH_TRANSACTION_COOKIE_PATH };
  }

  @Get('login')
  @Public()
  async loginWithSiau(@Res() response: Response) {
    const { url, transactionId } = await this.siauService.createAuthorizationUrl();
    response.cookie(OAUTH_TRANSACTION_COOKIE_NAME, transactionId, {
      ...this.transactionCookieOptions,
      maxAge: OAUTH_TRANSACTION_TTL_MS,
    });
    response.redirect(url);
  }

  @Get('callback')
  @Public()
  async siauCallback(@Query() query: SiauCallbackDto, @Req() request: Request, @Res() response: Response) {
    response.clearCookie(OAUTH_TRANSACTION_COOKIE_NAME, this.transactionCookieOptions);
    try {
      const transactionId = readSessionCookie(request.headers.cookie, OAUTH_TRANSACTION_COOKIE_NAME);
      const transaction = await this.siauService.consumeTransaction(transactionId, query.state);
      if (query.error || !query.code) {
        const error = query.error === 'access_denied' && !query.code ? 'access_denied' : 'authorization_failed';
        return response.redirect(this.frontendUrl('/login', error));
      }
      const result = await this.authService.completeSiauLogin(query.code, transaction);
      const previousSessionId = readSessionCookie(request.headers.cookie);
      if (previousSessionId) await this.sessionService.destroy(previousSessionId);
      response.cookie(SESSION_COOKIE_NAME, result.session.id, {
        ...this.cookieOptions,
        maxAge: this.sessionService.sessionTtl,
      });
      return response.redirect(this.frontendUrl('/'));
    } catch (error) {
      if (
        (this.configService.get('NODE_ENV') ?? 'development') === 'development' &&
        error instanceof Prisma.PrismaClientKnownRequestError
      ) {
        // Prisma messages can include query arguments; only log schema metadata.
        const { modelName, column, field_name, target, constraint } = error.meta ?? {};
        const operation = error.message
          .match(/\b(user|authSession|oAuthTransaction)\.(findUnique|create|update|deleteMany)\(/)?.[0]
          .slice(0, -1);
        this.logger.warn({
          message: 'SIAU callback failed',
          name: error.name,
          code: error.code,
          operation,
          modelName,
          column,
          field_name,
          target,
          constraint,
        });
      } else {
        this.logger.warn(`SIAU callback failed: ${error instanceof Error ? error.name : 'Unknown error'}`);
      }
      const code =
        error instanceof BadGatewayException
          ? 'siau_unavailable'
          : error instanceof BadRequestException
            ? 'invalid_state'
            : 'authorization_failed';
      return response.redirect(this.frontendUrl('/login', code));
    }
  }

  private frontendUrl(path: '/' | '/login', error?: string): string {
    const url = new URL(
      path,
      this.configService.get('SIREFO_UI_URL') ?? this.configService.getOrThrow('SIREFO_PUBLIC_URL'),
    );
    if (error) url.searchParams.set('error', error);
    return url.toString();
  }
}
