import { createRedisClient } from './../src/modules/sessions/stores/redis-session.store';

/**
 * Clears the Redis rate limit counters.
 *
 * Only needed for RATE_LIMIT_STORE=redis: the in-memory storage dies with the
 * app, but Redis keeps a counter for the whole window, so a second run inside
 * AUTH_RATE_LIMIT_TTL would start already blocked. Without this the throttle
 * suite passes once and then fails for fifteen minutes.
 */
export const resetThrottleCounters = async (): Promise<void> => {
  if (process.env.RATE_LIMIT_STORE !== 'redis') {
    return;
  }

  const client = createRedisClient(process.env.REDIS_URL as string);

  await client.connect();

  try {
    // scanIterator rather than KEYS, which blocks the server on a large keyspace.
    for await (const keys of client.scanIterator({ MATCH: 'throttle:*' })) {
      if (keys.length > 0) {
        await client.del(keys);
      }
    }
  } finally {
    await client.quit();
  }
};
