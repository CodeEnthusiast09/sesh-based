import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { User } from './../src/modules/users/entities/user.entity';
import { resetThrottleCounters } from './reset-throttle-counters';

// Run via `npm run test:e2e:throttle`, which sets AUTH_RATE_LIMIT_MAX low.
const authLimit = Number(process.env.AUTH_RATE_LIMIT_MAX);

const password = 'correct-horse-battery';

/**
 * Builds an app with TRUSTED_PROXIES set to the given value. The config factory
 * reads process.env when the module initialises, so the variable has to be in
 * place before compile(). Each call gets its own in-memory throttler storage,
 * which is what keeps the two cases from sharing a bucket.
 */
const buildApp = async (
  trustedProxies: string | undefined,
): Promise<{ app: NestExpressApplication; users: Repository<User> }> => {
  const previous = process.env.TRUSTED_PROXIES;

  if (trustedProxies === undefined) {
    delete process.env.TRUSTED_PROXIES;
  } else {
    process.env.TRUSTED_PROXIES = trustedProxies;
  }

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  process.env.TRUSTED_PROXIES = previous ?? '';

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  return {
    app,
    users: moduleFixture.get<Repository<User>>(getRepositoryToken(User)),
  };
};

const loginAs = (app: NestExpressApplication, email: string, ip: string) =>
  request(app.getHttpServer())
    .post('/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password: 'wrong-password-here' });

describe('X-Forwarded-For and rate limiting (e2e)', () => {
  // Redis keeps a counter for the whole window, so without this a second run
  // inside AUTH_RATE_LIMIT_TTL would start already blocked. No-op on memory.
  beforeAll(resetThrottleCounters);

  it('is configured with a low limit for this run', () => {
    expect(authLimit).toBeGreaterThan(0);
    expect(authLimit).toBeLessThan(20);
  });

  describe('with TRUSTED_PROXIES unset', () => {
    let app: NestExpressApplication;
    let users: Repository<User>;
    const email = `proxy-off-${randomUUID()}@task141.mil`;

    beforeAll(async () => {
      ({ app, users } = await buildApp(undefined));

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);
    });

    afterAll(async () => {
      await users.delete({ email });
      await app.close();
    });

    // The whole point of the default. Trusting a caller-supplied header would
    // let an attacker send a new IP per request and never hit the limit at all.
    it('ignores the header, so a forged IP does not buy a fresh budget', async () => {
      const first: number[] = [];

      for (let i = 0; i < authLimit + 1; i += 1) {
        first.push((await loginAs(app, email, '203.0.113.10')).status);
      }

      expect(first).toContain(401);
      expect(first.at(-1)).toBe(429);

      const forged = await loginAs(app, email, '198.51.100.77');

      expect(forged.status).toBe(429);
    });
  });

  describe('with TRUSTED_PROXIES covering the loopback address', () => {
    let app: NestExpressApplication;
    let users: Repository<User>;
    const email = `proxy-on-${randomUUID()}@task141.mil`;

    beforeAll(async () => {
      ({ app, users } = await buildApp('127.0.0.1,::1'));

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);
    });

    afterAll(async () => {
      await users.delete({ email });
      await app.close();
    });

    // Behind a real proxy the header is the only way to tell clients apart.
    // Without this, every user shares the proxy's IP and therefore one bucket,
    // so one person's failed logins would lock out everyone else.
    it('reads the header, so each client gets its own budget', async () => {
      const first: number[] = [];

      for (let i = 0; i < authLimit + 1; i += 1) {
        first.push((await loginAs(app, email, '203.0.113.10')).status);
      }

      expect(first.at(-1)).toBe(429);

      const other = await loginAs(app, email, '198.51.100.77');

      expect(other.status).toBe(401);
    });
  });
});
