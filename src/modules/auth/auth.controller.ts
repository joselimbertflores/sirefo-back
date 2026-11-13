import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AuthSession, User } from 'generated/prisma';

import { EnvVars } from 'src/config';
import { AuthService } from './auth.service';
import {
  getSessionCookieOptions,
  OAUTH_TRANSACTION_COOKIE_NAME,
  OAUTH_TRANSACTION_COOKIE_PATH,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from './constants';
import { AuthDto, SiauBackchannelLogoutDto, UpdateMyUserDto } from './dto';
import { GetAuthSessionRequest, GetUserRequest, Public } from './decorators';
import { SessionService } from './services/session.service';
import { SiauService } from './services/siau.service';

@Controller('auth')
export class AuthController {
  private readonly cookieOptions: CookieOptions;
  private readonly transactionCookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly siauService: SiauService,
    configService: ConfigService<EnvVars>,
  ) {
    this.cookieOptions = getSessionCookieOptions(
      configService.getOrThrow('SIREFO_PUBLIC_URL'),
      configService.get('NODE_ENV'),
    );
    this.transactionCookieOptions = { ...this.cookieOptions, path: OAUTH_TRANSACTION_COOKIE_PATH };
  }

  @Post('login')
  @Public()
  async login(@Body() body: AuthDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.loginLocal(body);
    const previousSessionId = readSessionCookie(request.headers.cookie);
    if (previousSessionId) await this.sessionService.destroy(previousSessionId);
    response.clearCookie(OAUTH_TRANSACTION_COOKIE_NAME, this.transactionCookieOptions);
    response.cookie(SESSION_COOKIE_NAME, result.session.id, {
      ...this.cookieOptions,
      maxAge: this.sessionService.sessionTtl,
    });
    return result.account;
  }

  @Get('me')
  getMyAccount(@GetUserRequest() user: User, @GetAuthSessionRequest() session: AuthSession) {
    return this.authService.getMyAccount(user, session);
  }

  @Post('backchannel-logout')
  @HttpCode(HttpStatus.OK)
  @Public()
  async siauBackchannelLogout(@Body() body: SiauBackchannelLogoutDto) {
    const sid = await this.siauService.validateLogoutToken(body.logout_token);
    await this.sessionService.destroySiauSessionsBySid(sid);
    return { message: 'Sesión cerrada' };
  }

  @Put('password')
  updateMyUser(@GetUserRequest() user: User, @Body() data: UpdateMyUserDto) {
    return this.authService.updateMyUser(user, data);
  }

  @Post('logout')
  @Public()
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const sessionId = readSessionCookie(request.headers.cookie);
    if (sessionId) await this.sessionService.logout(sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions);
    response.clearCookie(OAUTH_TRANSACTION_COOKIE_NAME, this.transactionCookieOptions);
    return { message: 'Sesión cerrada' };
  }
}
