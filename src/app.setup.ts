import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Single source of truth for app-level wiring, shared by main.ts and the e2e
 * tests. Kept here so a test app can never quietly differ from the real one:
 * missing cookie-parser in tests, for example, made every cookie look absent.
 */
export const configureApp = (app: INestApplication): void => {
  const config = app.get(ConfigService);

  app.use(cookieParser());

  // credentials: true is required for the browser to send the session cookie
  // cross-origin. That in turn forbids a wildcard origin, hence the env value.
  app.enableCors({
    origin: config.getOrThrow<string>('app.corsOrigin'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
};
