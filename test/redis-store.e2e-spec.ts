import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import { AppModule } from './../src/app.module';
import {
  generateCsrfToken,
  generateSessionId,
} from './../src/modules/sessions/session-id';
import {
  createRedisClient,
  type RedisClient,
} from './../src/modules/sessions/stores/redis-session.store';
import {
  addSeconds,
  SessionRecord,
} from './../src/modules/sessions/session.types';
import {
  SESSION_STORE,
  type SessionStore,
} from './../src/modules/sessions/stores/session-store.interface';

const isRedis = process.env.SESSION_STORE === 'redis';

/**
 * Redis-only behaviour: expiry removes the session key but leaves its ID in the
 * user index set, because Redis has no way to cascade. Nothing else prunes it,
 * so listByUser has to. Skipped when running against Postgres, where foreign
 * keys and the expiry predicate make the situation impossible.
 */
const describeRedis = isRedis ? describe : describe.skip;

describeRedis('Redis session store index pruning', () => {
  let moduleFixture: TestingModule;
  let store: SessionStore;
  /** Raw client, used to simulate a TTL expiry the store cannot cause itself. */
  let raw: RedisClient;

  const userId = randomUUID();

  const buildSession = (): SessionRecord => {
    const now = new Date();

    return {
      id: generateSessionId().hashed,
      userId,
      csrfToken: generateCsrfToken(),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: addSeconds(now, 1800),
      absoluteExpiresAt: addSeconds(now, 3600),
      userAgent: 'task141-e2e/1.0',
      ip: '127.0.0.1',
      rememberMe: false,
    };
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleFixture.init();

    store = moduleFixture.get<SessionStore>(SESSION_STORE);

    raw = createRedisClient(process.env.REDIS_URL as string);
    await raw.connect();
  });

  afterAll(async () => {
    await store.deleteByUser(userId);
    await raw.close();
    await moduleFixture.close();
  });

  it('drops an expired session from the listing and prunes the index', async () => {
    const live = buildSession();
    const doomed = buildSession();

    await store.create(live);
    await store.create(doomed);

    expect(await store.listByUser(userId)).toHaveLength(2);

    // Drop the session key the way a TTL expiry does: the key vanishes, but
    // Redis leaves the ID sitting in the user index set.
    await raw.del(`session:${doomed.id}`);

    const indexBefore = await raw.sMembers(`user_sessions:${userId}`);
    expect(indexBefore).toContain(doomed.id);

    const listed = await store.listByUser(userId);

    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(live.id);

    // The stale ID is gone, so the set does not grow without bound.
    const indexAfter = await raw.sMembers(`user_sessions:${userId}`);
    expect(indexAfter).not.toContain(doomed.id);
    expect(indexAfter).toContain(live.id);
  });

  it('returns sessions most recently seen first', async () => {
    await store.deleteByUser(userId);

    const older = buildSession();
    const newer = buildSession();

    await store.create({ ...older, lastSeenAt: addSeconds(new Date(), -60) });
    await store.create(newer);

    const listed = await store.listByUser(userId);

    expect(listed.map((session) => session.id)).toEqual([newer.id, older.id]);
  });
});
