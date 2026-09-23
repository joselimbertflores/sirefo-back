import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readSessionCookie } from '../constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService } from '../services/session.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const sessionId = readSessionCookie(request.headers.cookie);
    const session = await this.sessionService.authenticate(sessionId);
    request['user'] = session.user;
    request['authSession'] = session;
    return true;
  }
}
