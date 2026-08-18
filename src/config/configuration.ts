import { parseDurationSeconds } from './duration';

const toBoolean = (value: string | undefined): boolean => value === 'true';

const toNumber = (value: string | undefined): number => Number(value);

/**
 * Groups raw process.env reads into namespaced sections. Every consumer reads
 * through the dot path (config.getOrThrow('session.idleTtlSeconds')) rather than
 * touching process.env directly.
 *
 * All TTLs are normalised to seconds here so nothing downstream re-parses them.
 */
export const configuration = () => ({
  app: {
    env: process.env.NODE_ENV,
    port: toNumber(process.env.PORT),
    corsOrigin: process.env.CORS_ORIGIN,
  },
  database: {
    host: process.env.DB_HOST,
    port: toNumber(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
    synchronize: toBoolean(process.env.DB_SYNCHRONIZE),
    logging: toBoolean(process.env.DB_LOGGING),
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  session: {
    store: process.env.SESSION_STORE,
    cookieName: process.env.SESSION_COOKIE_NAME,
    cookieSecure: toBoolean(process.env.SESSION_COOKIE_SECURE),
    cookieSameSite: process.env.SESSION_COOKIE_SAMESITE,
    cookieDomain: process.env.SESSION_COOKIE_DOMAIN || undefined,
    idleTtlSeconds: parseDurationSeconds(
      process.env.SESSION_IDLE_TTL as string,
    ),
    absoluteTtlSeconds: parseDurationSeconds(
      process.env.SESSION_ABSOLUTE_TTL as string,
    ),
    rememberIdleTtlSeconds: parseDurationSeconds(
      process.env.SESSION_REMEMBER_IDLE_TTL as string,
    ),
    rememberAbsoluteTtlSeconds: parseDurationSeconds(
      process.env.SESSION_REMEMBER_ABSOLUTE_TTL as string,
    ),
  },
  csrf: {
    headerName: process.env.CSRF_HEADER_NAME,
    cookieName: process.env.CSRF_COOKIE_NAME,
  },
  argon2: {
    memoryKib: toNumber(process.env.ARGON2_MEMORY_KIB),
    iterations: toNumber(process.env.ARGON2_ITERATIONS),
    parallelism: toNumber(process.env.ARGON2_PARALLELISM),
  },
});
