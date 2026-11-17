import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class AsfiCredentialsDto {
  @IsString()
  @IsEmail()
  asfiUsername: string;

  @IsString()
  @MinLength(4)
  @Matches(/\S/)
  asfiPassword: string;
}
