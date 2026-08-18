import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { parseDurationSeconds } from './../src/config/duration';
import {
  generateCsrfToken,
  generateSessionId,
  hashSessionId,
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

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'sid';

/** response.headers is loosely typed; this contains the `any` in one place. */
const setCookieHeaders = (response: request.Response): string[] => {
  const header: unknown = response.headers['set-cookie'];

  if (Array.isArray(header)) {
    return header.filter((value): value is string => typeof value === 'string');
  }

  return typeof header === 'string' ? [header] : [];
};

/** The raw session ID, as the browser would store it. */
const readSessionCookie = (response: request.Response): string | undefined =>
  setCookieHeaders(response)
    .find((value) => value.startsWith(`${COOKIE_NAME}=`))
    ?.split(';')[0]
    .split('=')[1];

/**
 * supertest's agent does not reliably persist cookies across calls to
 * getHttpServer(), so the cookie is carried explicitly. It also matches what
 * the browser actually sends back.
 */
const cookieHeader = (response: request.Response): string =>
  setCookieHeaders(response)
    .map((value) => value.split(';')[0])
    .join('; ');

describe('Session auth (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;
  // Asserted through the store interface, not the Postgres repository, so the
  // same suite proves both backends behave identically.
  let store: SessionStore;

  const password = 'correct-horse-battery';
  const email = `session-${randomUUID()}@task141.mil`;

  const userAgent = 'task141-e2e/1.0';

  const login = (body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', userAgent)
      .send({ email, password, ...body });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    users = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    store = moduleFixture.get<SessionStore>(SESSION_STORE);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
  });

  afterAll(async () => {
    // Postgres cascades from users; Redis does not, so revoke explicitly.
    const owner = await users.findOneBy({ email });

    if (owner) {
      await store.deleteByUser(owner.id);
    }

    await users.delete({ email });
    await app.close();
  });

  it('rejects /auth/me without a cookie', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);

    expect(response.body).toMatchObject({ error: 'Unauthorized' });
  });

  it('sets an HttpOnly, SameSite cookie on login', async () => {
    const response = await login().expect(200);
    const header = response.headers['set-cookie'];
    const cookie = (Array.isArray(header) ? header : [header]).join(';');

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite');
    expect(cookie).toContain('Path=/');
  });

  it('stores only the hash of the session ID, never the raw value', async () => {
    const response = await login().expect(200);
    const rawId = readSessionCookie(response);

    expect(rawId).toBeDefined();

    const stored = await store.findById(hashSessionId(rawId as string));

    expect(stored).not.toBeNull();
    expect(stored?.id).not.toBe(rawId);
    expect(stored?.id).toHaveLength(64);
  });

  it('sets an idle clock that is earlier than the absolute clock', async () => {
    const response = await login().expect(200);
    const stored = await store.findById(
      hashSessionId(readSessionCookie(response) as string),
    );

    expect(stored).not.toBeNull();
    expect(stored?.idleExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(stored?.absoluteExpiresAt.getTime()).toBeGreaterThan(
      (stored as NonNullable<typeof stored>).idleExpiresAt.getTime(),
    );
    expect(stored?.rememberMe).toBe(false);
    expect(stored?.userAgent).toBe(userAgent);
  });

  it('accepts /auth/me with the cookie and logs out cleanly', async () => {
    const cookie = cookieHeader(await login().expect(200));

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body).toMatchObject({ data: { email } });

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('deletes the session row on logout', async () => {
    const response = await login().expect(200);
    const id = hashSessionId(readSessionCookie(response) as string);

    expect(await store.findById(id)).not.toBeNull();

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookieHeader(response))
      .expect(200);

    expect(await store.findById(id)).toBeNull();
  });

  it('distinguishes a missing cookie from a forged one', async () => {
    // Different messages prove the cookie was actually parsed and looked up,
    // rather than the request failing before it was ever read.
    const missing = await request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);

    const forged = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${COOKIE_NAME}=not-a-real-session-id`)
      .expect(401);

    expect(missing.body).toMatchObject({
      message: 'Authentication required',
    });
    expect(forged.body).toMatchObject({
      message: 'Session is invalid or has expired',
    });
  });

  it('rotates the session ID on login and retires the old one', async () => {
    const first = await login().expect(200);
    const firstId = hashSessionId(readSessionCookie(first) as string);

    expect(await store.findById(firstId)).not.toBeNull();

    // Log in again carrying the existing cookie, as a browser would.
    const second = await request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', userAgent)
      .set('Cookie', cookieHeader(first))
      .send({ email, password })
      .expect(200);

    const secondId = hashSessionId(readSessionCookie(second) as string);

    expect(secondId).not.toBe(firstId);
    expect(await store.findById(firstId)).toBeNull();
    expect(await store.findById(secondId)).not.toBeNull();
  });

  it('leaves other devices logged in when one of them logs in again', async () => {
    const deviceA = await login().expect(200);
    const deviceAId = hashSessionId(readSessionCookie(deviceA) as string);

    // A second login with no cookie stands in for a different device.
    const deviceB = await login().expect(200);
    const deviceBId = hashSessionId(readSessionCookie(deviceB) as string);

    expect(deviceBId).not.toBe(deviceAId);
    expect(await store.findById(deviceAId)).not.toBeNull();
    expect(await store.findById(deviceBId)).not.toBeNull();
  });

  it('uses the longer clocks when rememberMe is set', async () => {
    const normal = await login().expect(200);
    const remembered = await login({ rememberMe: true }).expect(200);

    const normalSession = await store.findById(
      hashSessionId(readSessionCookie(normal) as string),
    );
    const rememberedSession = await store.findById(
      hashSessionId(readSessionCookie(remembered) as string),
    );

    expect(normalSession?.rememberMe).toBe(false);
    expect(rememberedSession?.rememberMe).toBe(true);

    const expectedNormal = parseDurationSeconds(
      process.env.SESSION_ABSOLUTE_TTL as string,
    );
    const expectedRemembered = parseDurationSeconds(
      process.env.SESSION_REMEMBER_ABSOLUTE_TTL as string,
    );
    const secondsFromNow = (date: Date): number =>
      Math.round((date.getTime() - Date.now()) / 1000);

    expect(
      secondsFromNow(
        (normalSession as NonNullable<typeof normalSession>).absoluteExpiresAt,
      ),
    ).toBeCloseTo(expectedNormal, -2);
    expect(
      secondsFromNow(
        (rememberedSession as NonNullable<typeof rememberedSession>)
          .absoluteExpiresAt,
      ),
    ).toBeCloseTo(expectedRemembered, -2);
  });

  it('slides the idle clock on activity without moving the absolute one', async () => {
    const response = await login().expect(200);
    const cookie = cookieHeader(response);
    const id = hashSessionId(readSessionCookie(response) as string);

    const before = await store.findById(id);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    const after = await store.findById(id);

    expect(after?.idleExpiresAt.getTime()).toBeGreaterThan(
      (before as NonNullable<typeof before>).idleExpiresAt.getTime(),
    );
    expect(after?.absoluteExpiresAt.getTime()).toBe(
      (before as NonNullable<typeof before>).absoluteExpiresAt.getTime(),
    );
  });

  it('rejects a session past its absolute cap even when the idle clock is healthy', async () => {
    const owner = await users.findOneByOrFail({ email });
    const { raw, hashed } = generateSessionId();
    const now = new Date();

    const expired: SessionRecord = {
      id: hashed,
      userId: owner.id,
      csrfToken: generateCsrfToken(),
      createdAt: addSeconds(now, -7200),
      lastSeenAt: now,
      // Idle clock is fine; only the absolute cap has passed.
      idleExpiresAt: addSeconds(now, 1800),
      absoluteExpiresAt: addSeconds(now, -1),
      userAgent,
      ip: '127.0.0.1',
      rememberMe: false,
    };

    await store.create(expired);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${COOKIE_NAME}=${raw}`)
      .expect(401);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({
      password: 'wrong-password-here',
    }).expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `ghost-${randomUUID()}@task141.mil`, password })
      .expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toMatchObject({
      message: 'Invalid email or password',
      error: 'Unauthorized',
    });
  });
});
