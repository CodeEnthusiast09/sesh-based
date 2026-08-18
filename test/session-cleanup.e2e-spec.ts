import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { SessionCleanupService } from './../src/modules/sessions/session-cleanup.service';
import {
  generateCsrfToken,
  generateSessionId,
} from './../src/modules/sessions/session-id';
import {
  addSeconds,
  type SessionRecord,
} from './../src/modules/sessions/session.types';
import {
  SESSION_STORE,
  type SessionStore,
} from './../src/modules/sessions/stores/session-store.interface';
import { User } from './../src/modules/users/entities/user.entity';

const isPostgres = process.env.SESSION_STORE !== 'redis';

describe('Session cleanup', () => {
  let moduleFixture: TestingModule;
  let store: SessionStore;
  let cleanup: SessionCleanupService;
  let dataSource: DataSource;

  let ownerId: string;
  const email = `cleanup-${randomUUID()}@task141.mil`;

  const buildSession = (offsetSeconds: number): SessionRecord => {
    const now = new Date();

    return {
      id: generateSessionId().hashed,
      userId: ownerId,
      csrfToken: generateCsrfToken(),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: addSeconds(now, offsetSeconds),
      absoluteExpiresAt: addSeconds(now, offsetSeconds),
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
    cleanup = moduleFixture.get(SessionCleanupService);
    dataSource = moduleFixture.get<DataSource>(getDataSourceToken());

    const users = dataSource.getRepository(User);
    const owner = await users.save(
      users.create({ email, passwordHash: 'not-used-by-this-spec' }),
    );
    ownerId = owner.id;
  });

  afterAll(async () => {
    await store.deleteByUser(ownerId);
    await dataSource.getRepository(User).delete({ email });
    await moduleFixture.close();
  });

  it('registers the sweep on a timer at startup', () => {
    const scheduler = moduleFixture.get(SchedulerRegistry);

    expect(scheduler.doesExist('interval', 'session-cleanup')).toBe(true);
  });

  it('removes expired sessions and leaves live ones alone', async () => {
    const expired = buildSession(-60);
    const live = buildSession(1800);

    await store.create(expired);
    await store.create(live);

    const removed = await cleanup.sweep();

    if (isPostgres) {
      expect(removed).toBeGreaterThanOrEqual(1);

      // Gone from the table, not merely filtered out of reads.
      const rows: unknown[] = await dataSource.query(
        'select 1 from sessions where id = $1',
        [expired.id],
      );
      expect(rows).toHaveLength(0);
    } else {
      // Redis expires keys itself, so the sweep has nothing left to do.
      expect(removed).toBe(0);
    }

    expect(await store.findById(live.id)).not.toBeNull();
  });
});
