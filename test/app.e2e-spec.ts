import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('Health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy with a reachable database', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Service is healthy',
      data: { database: 'up' },
    });
  });

  it('returns the error envelope for an unknown route', async () => {
    const response = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: 'NotFound',
    });
  });
});
