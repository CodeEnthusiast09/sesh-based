import { randomUUID } from 'node:crypto';

import { createRedisClient } from '../../modules/sessions/stores/redis-session.store';
import { RateLimiterFaultError } from './rate-limiter-fault.error';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Proves the split between the two failure modes actually happens: a
 * server-side script error (the key exists as the wrong type, so the script's
 * INCR fails) must come back as a RateLimiterFaultError, which is what tells
 * the caller to fail closed instead of open. Skipped without REDIS_URL, same
 * as the Go sibling's equivalent test.
 */
describe('RedisThrottlerStorage', () => {
  const url = process.env.REDIS_URL;

  (url ? describe : describe.skip)('increment', () => {
    let client: ReturnType<typeof createRedisClient>;
    let storage: RedisThrottlerStorage;

    beforeAll(async () => {
      client = createRedisClient(url as string);
      await client.connect();
      storage = new RedisThrottlerStorage(client);
    });

    afterAll(async () => {
      if (client.isOpen) {
        await client.quit();
      }
    });

    it('throws a RateLimiterFaultError when the server rejects the script', async () => {
      const key = randomUUID();

      // Seed the key the script will INCR as a list instead of a string, so
      // the server rejects the script with WRONGTYPE: reachable, but
      // complaining, exactly the shape of bug this is meant to catch.
      await client.rPush(`throttle:${key}`, 'not-a-counter');

      await expect(storage.increment(key, 60_000, 5, 60_000)).rejects.toThrow(
        RateLimiterFaultError,
      );
    });

    it('still returns a normal record for an unpoisoned key', async () => {
      const key = randomUUID();

      const record = await storage.increment(key, 60_000, 5, 60_000);

      expect(record).toMatchObject({ totalHits: 1, isBlocked: false });
    });
  });
});
