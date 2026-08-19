import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
  validateSync,
} from 'class-validator';

import { DURATION_REGEX } from './duration';

const BOOLEAN_VALUES = ['true', 'false'];

const durationMessage = (property: string): string =>
  `${property} must be a duration such as "30m", "24h" or "30d"`;

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT: number;

  @IsString()
  CORS_ORIGIN: string;

  @IsString()
  DB_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DB_PORT: number;

  @IsString()
  DB_USER: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD: string;

  @IsString()
  DB_NAME: string;

  @IsIn(BOOLEAN_VALUES)
  DB_SYNCHRONIZE: string;

  @IsIn(BOOLEAN_VALUES)
  DB_LOGGING: string;

  @IsUrl({ protocols: ['redis', 'rediss'], require_tld: false })
  REDIS_URL: string;

  @IsIn(['postgres', 'redis'])
  SESSION_STORE: string;

  @IsString()
  SESSION_COOKIE_NAME: string;

  @IsIn(BOOLEAN_VALUES)
  SESSION_COOKIE_SECURE: string;

  @IsIn(['lax', 'strict', 'none'])
  SESSION_COOKIE_SAMESITE: string;

  @IsOptional()
  @IsString()
  SESSION_COOKIE_DOMAIN?: string;

  @Matches(DURATION_REGEX, { message: durationMessage('SESSION_IDLE_TTL') })
  SESSION_IDLE_TTL: string;

  @Matches(DURATION_REGEX, { message: durationMessage('SESSION_ABSOLUTE_TTL') })
  SESSION_ABSOLUTE_TTL: string;

  @Matches(DURATION_REGEX, {
    message: durationMessage('SESSION_REMEMBER_IDLE_TTL'),
  })
  SESSION_REMEMBER_IDLE_TTL: string;

  @Matches(DURATION_REGEX, {
    message: durationMessage('SESSION_REMEMBER_ABSOLUTE_TTL'),
  })
  SESSION_REMEMBER_ABSOLUTE_TTL: string;

  @Matches(DURATION_REGEX, {
    message: durationMessage('SESSION_CLEANUP_INTERVAL'),
  })
  SESSION_CLEANUP_INTERVAL: string;

  @Matches(DURATION_REGEX, { message: durationMessage('RATE_LIMIT_TTL') })
  RATE_LIMIT_TTL: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_MAX: number;

  @Matches(DURATION_REGEX, { message: durationMessage('AUTH_RATE_LIMIT_TTL') })
  AUTH_RATE_LIMIT_TTL: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTH_RATE_LIMIT_MAX: number;

  @IsString()
  CSRF_HEADER_NAME: string;

  @IsString()
  CSRF_COOKIE_NAME: string;

  @Type(() => Number)
  @IsInt()
  @Min(8)
  PASSWORD_MIN_LENGTH: number;

  // OWASP second-recommended argon2id profile is 19456 KiB / t=2 / p=1.
  @Type(() => Number)
  @IsInt()
  @Min(8192)
  ARGON2_MEMORY_KIB: number;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  ARGON2_ITERATIONS: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ARGON2_PARALLELISM: number;
}

/**
 * Runs before the configuration() factory (ConfigModule calls validate() first),
 * so a missing or malformed key fails the boot with a precise per-field message
 * instead of surfacing as `undefined` deep inside a request later.
 */
export const validate = (
  config: Record<string, unknown>,
): EnvironmentVariables => {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    excludeExtraneousValues: false,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');

    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  return validated;
};
