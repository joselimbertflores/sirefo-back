import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';

export const GetAuthSessionRequest = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const session = request['authSession'];
  if (!session) throw new InternalServerErrorException('Authentication session not found in request');
  return session;
});
