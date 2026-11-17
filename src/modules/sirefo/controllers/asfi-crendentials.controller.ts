import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { User } from 'generated/prisma';

import { GetUserRequest, Role } from 'src/modules/auth/decorators';
import { UserRole } from 'src/modules/users/domain';

import { AsfiCredentials, GetAsfiCredentialsRequest } from '../decorators';
import { AsfiCrendentialsService, SirefoService } from '../services';
import { IAsfiCredentials } from '../infrastructure';
import { AsfiCredentialsDto } from '../dtos';

@Role(UserRole.EMPLOYEE)
@Controller('asfi-crendentials')
export class AsfiCrendentialsController {
  constructor(
    private asfiCredentials: AsfiCrendentialsService,
    private sirefoService: SirefoService,
  ) {}

  @Get()
  @AsfiCredentials()
  checkCredentials(@GetAsfiCredentialsRequest() credentials: IAsfiCredentials) {
    return {
      email: credentials.email,
      valid: true,
    };
  }

  @Patch()
  setCredentials(@GetUserRequest() user: User, @Body() body: AsfiCredentialsDto) {
    return this.asfiCredentials.setCredentials(user.id, body);
  }

  @Post('validate')
  async validateCredentials(@Body() { asfiUsername, asfiPassword }: AsfiCredentialsDto) {
    await this.sirefoService.consultarCabecera({ email: asfiUsername, password: asfiPassword });
    return { ok: true, message: 'Valid credentials' };
  }

  @Delete(':userId')
  @Role(UserRole.ADMIN)
  resetCredentials(@Param('userId', ParseIntPipe) userId: number) {
    return this.asfiCredentials.resetCredentials(userId);
  }
}
