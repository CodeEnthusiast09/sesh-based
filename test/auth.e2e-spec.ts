import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { ApiResponse } from './../src/common/interfaces/api-response.interface';
import { User } from './../src/modules/users/entities/user.entity';

/** supertest types `body` as any; this narrows it to the response envelope. */
const envelope = <T = unknown>(response: request.Response): ApiResponse<T> =>
  response.body as ApiResponse<T>;

describe('Auth registration (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;

  const password = 'correct-horse-battery';
  const createdEmails: string[] = [];

  const uniqueEmail = (): string => {
    const email = `user-${randomUUID()}@task141.mil`;
    createdEmails.push(email.toLowerCase());
    return email;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    users = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await users.delete(createdEmails.map((email) => ({ email })));
    }
    await app.close();
  });

  it('registers a user and never returns the password hash', async () => {
    const email = uniqueEmail();

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      message: 'Registration successful',
      data: { email: email.toLowerCase() },
    });
    expect(JSON.stringify(response.body)).not.toContain('argon2');
    expect(envelope(response).data).not.toHaveProperty('passwordHash');
  });

  it('stores an argon2id hash using the configured parameters', async () => {
    const email = uniqueEmail();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const stored = await users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOneOrFail();

    // node-argon2 emits the parameters as m,p,t. Asserted individually so the
    // test proves the env values reached the hash, regardless of their order.
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(stored.passwordHash).toContain(`m=${process.env.ARGON2_MEMORY_KIB}`);
    expect(stored.passwordHash).toContain(
      `p=${process.env.ARGON2_PARALLELISM}`,
    );
    expect(stored.passwordHash).toContain(`t=${process.env.ARGON2_ITERATIONS}`);
    expect(stored.passwordHash).not.toContain(password);
  });

  it('treats email uniqueness as case-insensitive', async () => {
    const email = uniqueEmail();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: email.toUpperCase(), password })
      .expect(409);

    expect(response.body).toEqual({
      success: false,
      message: 'Email is already registered',
      error: 'Conflict',
    });
  });

  it('rejects a password shorter than the configured minimum', async () => {
    const minLength = Number(process.env.PASSWORD_MIN_LENGTH);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: 'a'.repeat(minLength - 1) })
      .expect(400);

    expect(envelope(response).error).toBe('ValidationError');
    expect(envelope(response).message).toContain(
      `password must be at least ${minLength} characters long`,
    );
  });

  it('rejects unknown properties', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniqueEmail(), password, isAdmin: true })
      .expect(400);

    expect(envelope(response).message).toContain(
      'property isAdmin should not exist',
    );
  });
});
