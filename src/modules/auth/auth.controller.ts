import { Body, Controller, Get, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AuthSession, User } from 'generated/prisma';

import { EnvVars } from 'src/config';
import { AuthService } from './auth.service';
import { readSessionCookie, SESSION_COOKIE_NAME } from './constants';
import { AuthDto, SiauCallbackDto, UpdateMyUserDto } from './dto';
import { GetAuthSessionRequest, GetUserRequest, Public } from './decorators';
import { SessionService } from './services/session.service';

@Controller('auth')
export class AuthController {
  private readonly frontendUrl: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    configService: ConfigService<EnvVars>,
  ) {
    this.frontendUrl = configService.get('SIREFO_UI_URL') ?? configService.getOrThrow('SIREFO_PUBLIC_URL');
    this.cookieOptions = {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: configService.get('NODE_ENV') === 'production',
    };
  }

  @Post('login')
  @Public()
  async login(@Body() body: AuthDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.loginLocal(body);
    response.cookie(SESSION_COOKIE_NAME, result.session.id, {
      ...this.cookieOptions,
      maxAge: this.sessionService.sessionTtl,
    });
    return result.account;
  }

  @Get('siau/login')
  @Public()
  async loginWithSiau(@Res() response: Response) {
    response.redirect(await this.authService.startSiauLogin());
  }

  @Get('siau/callback')
  @Public()
  async siauCallback(@Query() query: SiauCallbackDto, @Res() response: Response) {
    const result = await this.authService.completeSiauLogin(query.code, query.state);
    response.cookie(SESSION_COOKIE_NAME, result.session.id, {
      ...this.cookieOptions,
      maxAge: this.sessionService.sessionTtl,
    });
    response.redirect(this.frontendUrl);
  }

  @Get('me')
  getMyAccount(@GetUserRequest() user: User, @GetAuthSessionRequest() session: AuthSession) {
    return this.authService.getMyAccount(user, session);
  }

  @Put('password')
  updateMyUser(@GetUserRequest() user: User, @Body() data: UpdateMyUserDto) {
    return this.authService.updateMyUser(user, data);
  }

  @Post('logout')
  @Public()
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const sessionId = readSessionCookie(request.headers.cookie);
    if (sessionId) await this.sessionService.destroy(sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions);
    return { message: 'Sesión cerrada' };
  }
}
