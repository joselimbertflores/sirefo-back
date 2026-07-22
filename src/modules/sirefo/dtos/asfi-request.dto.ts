import { Transform, Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsIn,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ValidateIf,
  IsDecimal,
  IsOptional,
  IsNotEmptyObject,
  IsObject,
  Validate,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import {
  IsAutoConclusionValid,
  IsDocumentNumber,
  IsExtensionValid,
  IsUniqueItem,
  IsValidPersonConstraint,
} from '../decorators';
import { VALID_EXTENSIONS } from '../constants';
import { AsfiFileDto } from './asfi-file.dto';

export class ItemRequestDto {
  @Validate(IsValidPersonConstraint)
  maternalLastName: string;

  @Validate(IsValidPersonConstraint)
  paternalLastName: string;

  @Validate(IsValidPersonConstraint)
  firstName: string;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => value?.toString())
  autoConclusion?: string;

  @Transform(({ value }) => (value ? String(value) : value))
  @IsString()
  @IsOptional()
  complement?: string;

  @Validate(IsExtensionValid, VALID_EXTENSIONS)
  extension: string;

  @IsString()
  @Validate(IsDocumentNumber, VALID_EXTENSIONS)
  @Transform(({ value }) => (value ? String(value) : value))
  documentNumber: string;

  @IsIn([1, 2, 3, 4, 5], { message: 'El tipo de documento debe ser: 1, 2, 3, 4 o 5' })
  @Type(() => Number)
  documentType: number;

  @IsString()
  @Transform(({ value }) => value?.toString())
  supportDocument: string;

  @IsNumber({}, { message: 'El numero de item debe ser un entero' })
  @Type(() => Number)
  item: number;

  @Transform(({ value }) => {
    const num = parseFloat(value);
    return isNaN(num) ? value : num.toFixed(2);
  })
  @IsDecimal(
    {
      decimal_digits: '2',
    },
    { message: 'El monto debe ser un numero con máximo 2 decimales' },
  )
  amount: string;

  @ValidateIf((obj) => [1, 3].includes(obj.documentType))
  @IsNotEmpty({ message: 'La razon social es obligatoria para personas juridicas' })
  businessName: string;

  @IsIn([1, 2, 3, 4], { message: 'El tipo de respaldo deber ser 1, 2, 3 o 4' })
  @Type(() => Number)
  supportType: string;
}

export class CreateAsfiRequestDto {
  @IsString({ message: 'El cargo de la autoridad solicitante debe ser un texto' })
  @IsNotEmpty()
  @Transform(({ value }) => value?.trim())
  authorityPosition: string;

  @IsString({ message: 'El nombre de la autoridad solicitante debe ser un texto' })
  @IsNotEmpty()
  @Transform(({ value }) => value?.trim())
  requestingAuthority: string;

  @Type(() => Number)
  @IsInt({ message: 'El código correlativo debe ser un número entero' })
  @Min(1, { message: 'El número no puede ser cero' })
  @Max(9999, { message: 'El número no debe exceder 9999' })
  requestCode: number;

  @IsString({ message: 'La gerencia debe ser un texto' })
  @IsNotEmpty()
  @Transform(({ value }) => value?.trim())
  department: string;

  @IsIn(['R', 'S'], { message: 'El tipo de procesos deber ser R o S' })
  processType: 'R' | 'S';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemRequestDto)
  @ArrayMinSize(1)
  @IsUniqueItem('item', { message: 'Cada item debe ser único' })
  @IsAutoConclusionValid()
  details: ItemRequestDto[];

  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => AsfiFileDto)
  file: AsfiFileDto;

  @IsString()
  @IsNotEmpty()
  dataSheetFile: string;
}

export class UpdateAsfiRequestDto extends PartialType(CreateAsfiRequestDto) {}
