import { IsNotEmpty, IsString } from 'class-validator';

export class SiauBackchannelLogoutDto {
  @IsString()
  @IsNotEmpty()
  logout_token: string;
}
