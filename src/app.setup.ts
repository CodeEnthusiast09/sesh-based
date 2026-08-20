import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

import type { NestExpressApplication } from '@nestjs/platform-express';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Single source of truth for app-level wiring, shared by main.ts and the e2e
 * tests. Kept here so a test app can never quietly differ from the real one:
 * missing cookie-parser in tests, for example, made every cookie look absent.
 */
export const configureApp = (app: NestExpressApplication): void => {
  const config = app.get(ConfigService);

  // Express reads X-Forwarded-For only for connections coming from a trusted
  // proxy, and trusts nobody by default. That default is the safe one: the
  // header is caller-supplied, so trusting it blindly would let anyone forge a
  // new IP per request and get a fresh rate limit bucket each time. Set
  // TRUSTED_PROXIES to your proxy's addresses when there is one in front,
  // otherwise every client shares the proxy's IP and therefore one bucket.
  const trustedProxies = config.get<string>('app.trustedProxies');

  app.set('trust proxy', trustedProxies ?? false);

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
