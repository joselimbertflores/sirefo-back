import { IsNotEmpty, IsString } from 'class-validator';

export class SiauCallbackDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  state: string;
}
