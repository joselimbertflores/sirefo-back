import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';

import { PaginationDto } from 'src/modules/common';

import { AssignableUserQueryDto, CreateUserDto, UpdateUserDto } from './dtos';
import { UserService } from './user.service';
import { Role } from '../auth/decorators';
import { UserRole } from './domain';

@Role(UserRole.ADMIN)
@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  @Get()
  findAll(@Query() params: PaginationDto) {
    return this.userService.findAll(params);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) userId: number, @Body() job: UpdateUserDto) {
    return this.userService.update(userId, job);
  }

  @Get('assignable')
  findAssignable(@Query() query: AssignableUserQueryDto) {
    return this.userService.findAssignable(query.term);
  }

  @Post()
  create(@Body() user: CreateUserDto) {
    return this.userService.create(user);
  }
}
