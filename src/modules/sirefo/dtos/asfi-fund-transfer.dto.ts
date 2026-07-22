import {
  ArrayMinSize,
  IsArray,
  IsDecimal,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNotEmptyObject,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsDocumentNumber, IsExtensionValid, IsUniqueItem, IsValidPersonConstraint } from '../decorators';
import { AsfiFileDto } from './asfi-file.dto';
import { VALID_EXTENSIONS } from '../constants';
import { PartialType } from '@nestjs/mapped-types';

export class ItemFundTransferDto {
  @Validate(IsValidPersonConstraint)
  maternalLastName: string;

  @Validate(IsValidPersonConstraint)
  paternalLastName: string;

  @Validate(IsValidPersonConstraint)
  firstName: string;

  @Transform(({ value }) => (value ? String(value) : value))
  @IsString()
  @IsOptional()
  complement?: string;

  @Validate(IsExtensionValid, VALID_EXTENSIONS)
  extension: string;

  @IsString()
  @IsNotEmpty()
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

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  accountNumber: string;

  @IsIn([1, 2, 3, 4])
  @Type(() => Number)
  accountCurrency: number;

  @IsString()
  @IsNotEmpty()
  transferCode: string;
}

export class CreateAsfiFundTransferDto {
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
  @Max(99999, { message: 'El número no debe exceder 9999' })
  requestCode: number;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => value?.trim())
  department: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemFundTransferDto)
  @ArrayMinSize(1)
  @IsUniqueItem('item', { message: 'Cada item debe ser único' })
  details: ItemFundTransferDto[];

  @IsUUID()
  asfiRequestId: string;

  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => AsfiFileDto)
  file: AsfiFileDto;

  @IsString()
  @IsNotEmpty()
  dataSheetFile: string;
}

export class UpdateAsfiFundTransferDto extends PartialType(CreateAsfiFundTransferDto) {}
