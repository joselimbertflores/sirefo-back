import { plainToInstance } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, Min, validateSync } from 'class-validator';

export class EnvVars {
  @IsString()
  ASFI_USER: string;

  @IsString()
  ASFI_PASSWORD: string;

  @IsString()
  ASFI_ENDPOINT: string;

  @IsString()
  HOST: string;

  @IsString()
  ENCRYPTION_KEY: string;

  @IsNumber()
  PORT: number;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  SIREFO_PUBLIC_URL: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @IsOptional()
  SIREFO_UI_URL?: string;

  @IsString()
  @IsNotEmpty()
  OAUTH_CLIENT_ID: string;

  @IsString()
  @IsNotEmpty()
  OAUTH_CLIENT_SECRET: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  IDENTITY_HUB_PUBLIC_URL: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @IsOptional()
  IDENTITY_HUB_INTERNAL_URL?: string;

  @IsNumber()
  @Min(300)
  @IsOptional()
  SESSION_TTL_SECONDS?: number;

  @IsIn(['development', 'test', 'production'])
  @IsOptional()
  NODE_ENV?: string;
}

export function validate(config: Record<string, unknown>): EnvVars {
  const validatedConfig = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
