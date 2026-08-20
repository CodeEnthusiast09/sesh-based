import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';

import { createRedisClient } from '../../modules/sessions/stores/redis-session.store';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Builds only the backend named by RATE_LIMIT_STORE, so a memory deployment
 * does not require Redis to be up. Returning undefined leaves the throttler on
 * its own in-memory storage, which is the package default.
 *
 * The storage opens its own Redis connection rather than sharing the session
 * store's, so the two stay independently switchable: RATE_LIMIT_STORE=redis
 * with SESSION_STORE=postgres is a valid combination and needs no special case.
 */
export const createThrottlerStorage = async (
  config: ConfigService,
): Promise<ThrottlerStorage | undefined> => {
  if (config.getOrThrow<string>('rateLimit.store') !== 'redis') {
    return undefined;
  }

  const logger = new Logger(RedisThrottlerStorage.name);
  const client = createRedisClient(config.getOrThrow<string>('redis.url'));

  // Without a listener, a dropped connection surfaces as an unhandled error
  // event and takes the process down.
  client.on('error', (error: Error) =>
    logger.error(`Redis connection error: ${error.message}`),
  );

  await client.connect();

  return new RedisThrottlerStorage(client);
};
