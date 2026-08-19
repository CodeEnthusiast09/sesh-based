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
import { User } from './../src/modules/users/entities/user.entity';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'sid';
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf_token';
const CSRF_HEADER = process.env.CSRF_HEADER_NAME ?? 'x-csrf-token';

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

const rawCookie = (response: request.Response, name: string): string =>
  setCookieHeaders(response).find((value) =>
    value.startsWith(`${name}=`),
  ) as string;

const csrfTokenOf = (response: request.Response): string =>
  rawCookie(response, CSRF_COOKIE).split(';')[0].split('=')[1];

describe('CSRF protection (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;

  const password = 'correct-horse-battery';
  const email = `csrf-${randomUUID()}@task141.mil`;

  const signIn = () =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  it('issues a session cookie that JS cannot read and a CSRF cookie it can', async () => {
    const response = await signIn().expect(200);

    // The session cookie must be HttpOnly so XSS cannot steal it.
    expect(rawCookie(response, COOKIE_NAME)).toContain('HttpOnly');
    // The CSRF cookie must NOT be, because the client has to echo it back.
    expect(rawCookie(response, CSRF_COOKIE)).not.toContain('HttpOnly');
  });

  it('rejects a state-changing request with no CSRF token', async () => {
    const session = await signIn().expect(200);

    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookieHeader(session))
      .expect(403);

    expect(response.body).toMatchObject({
      error: 'Forbidden',
      message: 'CSRF token missing or invalid',
    });

    // The session survived the rejected request.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(session))
      .expect(200);
  });

  it('rejects a wrong CSRF token', async () => {
    const session = await signIn().expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookieHeader(session))
      .set(CSRF_HEADER, 'not-the-right-token')
      .expect(403);
  });

  it("rejects another session's CSRF token", async () => {
    const mine = await signIn().expect(200);
    const theirs = await signIn().expect(200);

    // This is what a per-session token buys over plain double-submit: a valid
    // token from elsewhere is still refused.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookieHeader(mine))
      .set(CSRF_HEADER, csrfTokenOf(theirs))
      .expect(403);
  });

  it('accepts the matching CSRF token', async () => {
    const session = await signIn().expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookieHeader(session))
      .set(CSRF_HEADER, csrfTokenOf(session))
      .expect(200);
  });

  it('does not require a token for safe methods', async () => {
    const session = await signIn().expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookieHeader(session))
      .expect(200);

    await request(app.getHttpServer())
      .get('/sessions')
      .set('Cookie', cookieHeader(session))
      .expect(200);
  });

  it('serves the token over /auth/csrf for clients that cannot read cookies', async () => {
    const session = await signIn().expect(200);

    const response = await request(app.getHttpServer())
      .get('/auth/csrf')
      .set('Cookie', cookieHeader(session))
      .expect(200);

    const body = response.body as ApiResponse<{ csrfToken: string }>;

    expect(body.data?.csrfToken).toBe(csrfTokenOf(session));
  });

  it('issues a fresh CSRF token when the session rotates on login', async () => {
    const first = await signIn().expect(200);
    const second = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Cookie', cookieHeader(first))
      .send({ email, password })
      .expect(200);

    expect(csrfTokenOf(second)).not.toBe(csrfTokenOf(first));
  });

  it('requires authentication before it even checks the token', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(401);
  });
});
