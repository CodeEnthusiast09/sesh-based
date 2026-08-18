import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient } from 'redis';

import { isExpired, SessionRecord } from '../session.types';
import { SessionStore } from './session-store.interface';

/**
 * Client type is derived from this factory rather than from createClient
 * directly: createClient's generic defaults resolve to a wider type than an
 * actual `createClient({ url })` call returns, so the two do not match.
 */
export const createRedisClient = (url: string) => createClient({ url });

export type RedisClient = ReturnType<typeof createRedisClient>;

const SESSION_PREFIX = 'session:';
const USER_INDEX_PREFIX = 'user_sessions:';

/** Dates do not survive JSON, so they are written as ISO strings and revived on read. */
type SerialisedSession = Omit<
  SessionRecord,
  'createdAt' | 'lastSeenAt' | 'idleExpiresAt' | 'absoluteExpiresAt'
> & {
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

@Injectable()
export class RedisSessionStore implements SessionStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisSessionStore.name);

  constructor(
    private readonly client: RedisClient,
    /** Upper bound for the user index key, so it cannot outlive every session. */
    private readonly maxSessionTtlSeconds: number,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }

  async create(record: SessionRecord): Promise<void> {
    const ttl = this.ttlSeconds(record, new Date());

    await this.client
      .multi()
      .set(this.sessionKey(record.id), this.serialise(record), {
        expiration: { type: 'EX', value: ttl },
      })
      .sAdd(this.userIndexKey(record.userId), record.id)
      .expire(this.userIndexKey(record.userId), this.maxSessionTtlSeconds)
      .exec();
  }

  async findById(id: string): Promise<SessionRecord | null> {
    const raw = await this.client.get(this.sessionKey(id));

    if (raw === null) {
      return null;
    }

    const record = this.deserialise(raw);

    // Redis TTL should already have removed this, but both clocks are checked
    // anyway so the two stores behave identically under any clock skew.
    if (isExpired(record, new Date())) {
      await this.delete(id);

      return null;
    }

    return record;
  }

  async touch(
    id: string,
    lastSeenAt: Date,
    idleExpiresAt: Date,
  ): Promise<void> {
    const raw = await this.client.get(this.sessionKey(id));

    if (raw === null) {
      return;
    }

    const record: SessionRecord = {
      ...this.deserialise(raw),
      lastSeenAt,
      idleExpiresAt,
    };
    const ttl = this.ttlSeconds(record, new Date());

    if (ttl <= 0) {
      await this.delete(id);

      return;
    }

    // Rewriting the value also resets the TTL, which is how the idle clock
    // slides. The absolute clock is untouched and still caps the new TTL.
    await this.client.set(this.sessionKey(id), this.serialise(record), {
      expiration: { type: 'EX', value: ttl },
    });
  }

  async delete(id: string): Promise<void> {
    const raw = await this.client.get(this.sessionKey(id));

    if (raw !== null) {
      const { userId } = this.deserialise(raw);
      await this.client.sRem(this.userIndexKey(userId), id);
    }

    await this.client.del(this.sessionKey(id));
  }

  async deleteByUser(userId: string, exceptId?: string): Promise<number> {
    const ids = await this.client.sMembers(this.userIndexKey(userId));
    const targets = ids.filter((id) => id !== exceptId);

    if (targets.length === 0) {
      return 0;
    }

    // DEL reports how many keys actually existed, which matches the row count
    // the Postgres store returns.
    const removed = await this.client.del(
      targets.map((id) => this.sessionKey(id)),
    );
    await this.client.sRem(this.userIndexKey(userId), targets);

    return removed;
  }

  async listByUser(userId: string): Promise<SessionRecord[]> {
    const indexKey = this.userIndexKey(userId);
    const ids = await this.client.sMembers(indexKey);

    if (ids.length === 0) {
      return [];
    }

    const values = await this.client.mGet(ids.map((id) => this.sessionKey(id)));
    const now = new Date();
    const alive: SessionRecord[] = [];
    const stale: string[] = [];

    ids.forEach((id, index) => {
      const raw = values[index];

      if (raw === null || raw === undefined) {
        // Redis expired the session key but leaves the ID sitting in this set.
        // Nothing else prunes it, so listing has to.
        stale.push(id);

        return;
      }

      const record = this.deserialise(raw);

      if (isExpired(record, now)) {
        stale.push(id);

        return;
      }

      alive.push(record);
    });

    if (stale.length > 0) {
      await this.client.sRem(indexKey, stale);
      this.logger.debug(
        `Pruned ${stale.length} stale session ids for ${userId}`,
      );
    }

    return alive.sort(
      (first, second) =>
        second.lastSeenAt.getTime() - first.lastSeenAt.getTime(),
    );
  }

  /** Redis expires session keys itself; the index is pruned lazily by listByUser. */
  deleteExpired(): Promise<number> {
    return Promise.resolve(0);
  }

  private sessionKey(id: string): string {
    return `${SESSION_PREFIX}${id}`;
  }

  private userIndexKey(userId: string): string {
    return `${USER_INDEX_PREFIX}${userId}`;
  }

  /** Whichever clock runs out first decides the key's lifetime. */
  private ttlSeconds(record: SessionRecord, now: Date): number {
    const deadline = Math.min(
      record.idleExpiresAt.getTime(),
      record.absoluteExpiresAt.getTime(),
    );

    return Math.max(1, Math.ceil((deadline - now.getTime()) / 1000));
  }

  private serialise(record: SessionRecord): string {
    return JSON.stringify(record);
  }

  private deserialise(raw: string): SessionRecord {
    const parsed = JSON.parse(raw) as SerialisedSession;

    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      lastSeenAt: new Date(parsed.lastSeenAt),
      idleExpiresAt: new Date(parsed.idleExpiresAt),
      absoluteExpiresAt: new Date(parsed.absoluteExpiresAt),
    };
  }
}
