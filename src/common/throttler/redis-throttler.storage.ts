import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ErrorReply } from 'redis';

import type { RedisClient } from '../../modules/sessions/stores/redis-session.store';
import { RateLimiterFaultError } from './rate-limiter-fault.error';

const KEY_PREFIX = 'throttle:';

/**
 * Derived from the interface rather than imported: @nestjs/throttler exports
 * ThrottlerStorage from its index but not ThrottlerStorageRecord, and reaching
 * into dist/ for it would break on any internal reshuffle.
 */
type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Lua rather than INCR followed by a separate PEXPIRE, because that pair can
 * lose the race where two instances both see the counter appear and neither
 * sets a TTL, leaving a key that never resets.
 *
 * A PTTL below zero means the key exists with no expiry, which only happens if
 * a previous run died between the two calls. Re-arming it there keeps one lost
 * race from blocking a caller forever.
 */
const HIT_SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])

if blocked > 0 then
  return {tonumber(redis.call('GET', KEYS[1])) or 0, redis.call('PTTL', KEYS[1]), 1, blocked}
end

local hits = redis.call('INCR', KEYS[1])

if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end

local remaining = redis.call('PTTL', KEYS[1])

if remaining < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  remaining = tonumber(ARGV[1])
end

if hits > tonumber(ARGV[2]) then
  redis.call('PSETEX', KEYS[2], ARGV[3], '1')
  return {hits, remaining, 1, tonumber(ARGV[3])}
end

return {hits, remaining, 0, 0}
`;

const toSeconds = (milliseconds: number): number =>
  Math.ceil(milliseconds / 1000);

/**
 * Keeps the throttler's counters in Redis instead of this process's memory, so
 * every instance behind a load balancer shares one window. With the default
 * in-memory storage each instance counts only its own traffic, which quietly
 * multiplies the configured limit by the number of instances.
 *
 * The fixed window here is deliberately simpler than the built-in storage's
 * per-hit decay: one INCR per request and one key that expires, which is also
 * exactly what the Go sibling does.
 *
 * Two failure modes, handled differently. Redis being unreachable fails open
 * (the request is served, the failure logged): that is the case fail-open
 * exists for. A response Redis sends back complaining about the script itself
 * is a RateLimiterFaultError instead, which is left to propagate and comes
 * back as a 500 through the global exception filter, because that failure
 * will not go away on retry and should not be swallowed silently.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly client: RedisClient) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<StorageRecord> {
    try {
      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] =
        (await this.client.eval(HIT_SCRIPT, {
          keys: [`${KEY_PREFIX}${key}`, `${KEY_PREFIX}${key}:blocked`],
          arguments: [String(ttl), String(limit), String(blockDuration)],
        })) as [number, number, number, number];

      return {
        totalHits,
        timeToExpire: toSeconds(timeToExpire),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: toSeconds(timeToBlockExpire),
      };
    } catch (error) {
      // ErrorReply means Redis was reached and ran the script, but complained
      // (a Lua error, wrong arity, wrong type on the key). That is a bug in
      // this script, not an outage, so it must not fail open the way a dropped
      // connection or timeout does: rethrowing lets it reach the global
      // exception filter and come back as a loud 500 instead of a limiter that
      // silently stopped limiting anything.
      if (error instanceof ErrorReply) {
        throw new RateLimiterFaultError(error);
      }

      // Fail open. Failing closed would turn a Redis blip into a total outage,
      // which hands an attacker a bigger prize than the brute-force window they
      // would otherwise get.
      this.logger.error(
        `Rate limit counter unavailable, allowing request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        totalHits: 0,
        timeToExpire: toSeconds(ttl),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }
}
