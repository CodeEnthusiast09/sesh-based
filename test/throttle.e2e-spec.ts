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

// Run via `npm run test:e2e:throttle`, which sets AUTH_RATE_LIMIT_MAX low. The
// main suite runs with the limiter effectively off, since it signs in far more
// often than any sane production limit would allow.
const authLimit = Number(process.env.AUTH_RATE_LIMIT_MAX);

describe('Rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  let users: Repository<User>;

  const password = 'correct-horse-battery';
  const email = `throttle-${randomUUID()}@task141.mil`;

  beforeAll(async () => {
    await resetThrottleCounters();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    users = moduleFixture.get<Repository<User>>(getRepositoryToken(User));

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
  });

  afterAll(async () => {
    await users.delete({ email });
    await app.close();
  });

  it('is configured with a low limit for this run', () => {
    expect(authLimit).toBeGreaterThan(0);
    expect(authLimit).toBeLessThan(20);
  });

  it('blocks brute force against login once the limit is reached', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong-password-here' });

    const statuses: number[] = [];

    for (let i = 0; i < authLimit + 3; i += 1) {
      statuses.push((await attempt()).status);
    }

    expect(
      statuses.filter((status) => status === 401).length,
    ).toBeLessThanOrEqual(authLimit);
    expect(statuses).toContain(429);
    // Once blocked it stays blocked, rather than letting every other request through.
    expect(statuses.at(-1)).toBe(429);
  });

  it('returns the standard envelope without leaking the exception class', async () => {
    const responses: request.Response[] = [];

    for (let i = 0; i < authLimit + 2; i += 1) {
      responses.push(
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'wrong-password-here' }),
      );
    }

    const blocked = responses.find((response) => response.status === 429);

    expect(blocked).toBeDefined();
    expect(blocked?.body).toMatchObject({
      success: false,
      error: 'TooManyRequests',
      message: 'Too many requests, please try again later',
    });
    expect(JSON.stringify(blocked?.body)).not.toContain('ThrottlerException');
  });
});
