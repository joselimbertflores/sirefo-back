import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '../domain';

export class CreateUserDto {
  @IsString()
  @Matches(/\S/)
  externalKey: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  position: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  position?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];
}

export class AssignableUserQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  term?: string;
}
