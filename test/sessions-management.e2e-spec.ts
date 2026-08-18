import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import type { ApiResponse } from './../src/common/interfaces/api-response.interface';
import { hashSessionId } from './../src/modules/sessions/session-id';
import type { PublicSession } from './../src/modules/sessions/session.types';
import { User } from './../src/modules/users/entities/user.entity';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'sid';

const setCookieHeaders = (response: request.Response): string[] => {
  const header: unknown = response.headers['set-cookie'];

  if (Array.isArray(header)) {
    return header.filter((value): value is string => typeof value === 'string');
  }

  return typeof header === 'string' ? [header] : [];
};

const cookieHeader = (response: request.Response): string =>
  setCookieHeaders(response)
    .map((value) => value.split(';')[0])
    .join('; ');

const sessionIdOf = (response: request.Response): string => {
  const raw = setCookieHeaders(response)
    .find((value) => value.startsWith(`${COOKIE_NAME}=`))
    ?.split(';')[0]
    .split('=')[1];

  return hashSessionId(raw as string);
};

describe('Session management (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;

  const password = 'correct-horse-battery';
  const owner = `owner-${randomUUID()}@task141.mil`;
  const other = `other-${randomUUID()}@task141.mil`;

  const signIn = (email: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    users = moduleFixture.get<Repository<User>>(getRepositoryToken(User));

    for (const email of [owner, other]) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);
    }
  });

  afterAll(async () => {
    await users.delete([{ email: owner }, { email: other }]);
    await app.close();
  });

  it('lists every active session and marks the current one', async () => {
    const deviceA = await signIn(owner).expect(200);
    const deviceB = await signIn(owner).expect(200);

    const response = await request(app.getHttpServer())
      .get('/sessions')
      .set('Cookie', cookieHeader(deviceA))
      .expect(200);

    const body = response.body as ApiResponse<PublicSession[]>;
    const listed = body.data as PublicSession[];
    const ids = listed.map((session) => session.id);

    expect(ids).toEqual(
      expect.arrayContaining([sessionIdOf(deviceA), sessionIdOf(deviceB)]),
    );
    expect(listed.filter((session) => session.current)).toHaveLength(1);
    expect(listed.find((session) => session.current)?.id).toBe(
      sessionIdOf(deviceA),
    );
  });

  it('never exposes the CSRF token of any session', async () => {
    const device = await signIn(owner).expect(200);

    const response = await request(app.getHttpServer())
      .get('/sessions')
      .set('Cookie', cookieHeader(device))
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('csrfToken');
  });

  it('revokes a single session and leaves the caller signed in', async () => {
    const deviceA = await signIn(owner).expect(200);
    const deviceB = await signIn(owner).expect(200);

    await request(app.getHttpServer())
      .delete(`/sessions/${sessionIdOf(deviceB)}`)
      .set('Cookie', cookieHeader(deviceA))
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(deviceB))
      .expect(401);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(deviceA))
      .expect(200);
  });

  it("refuses to revoke another user's session", async () => {
    const victim = await signIn(owner).expect(200);
    const attacker = await signIn(other).expect(200);

    const response = await request(app.getHttpServer())
      .delete(`/sessions/${sessionIdOf(victim)}`)
      .set('Cookie', cookieHeader(attacker))
      .expect(404);

    // Reported as not found rather than forbidden, so the response cannot be
    // used to confirm that a session ID exists.
    expect(response.body).toMatchObject({ error: 'NotFound' });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(victim))
      .expect(200);
  });

  it('revokes every other session without touching the caller or other users', async () => {
    const keep = await signIn(owner).expect(200);
    const dropped = await signIn(owner).expect(200);
    const bystander = await signIn(other).expect(200);

    const response = await request(app.getHttpServer())
      .delete('/sessions')
      .set('Cookie', cookieHeader(keep))
      .expect(200);

    const body = response.body as ApiResponse<{ revoked: number }>;
    expect(body.data?.revoked).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(dropped))
      .expect(401);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(keep))
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(bystander))
      .expect(200);
  });

  it('clears the cookie when you revoke the session you are using', async () => {
    const device = await signIn(owner).expect(200);

    const response = await request(app.getHttpServer())
      .delete(`/sessions/${sessionIdOf(device)}`)
      .set('Cookie', cookieHeader(device))
      .expect(200);

    expect(cookieHeader(response)).toContain(`${COOKIE_NAME}=`);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(device))
      .expect(401);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/sessions').expect(401);
    await request(app.getHttpServer()).delete('/sessions').expect(401);
  });
});
