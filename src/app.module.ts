import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { createThrottlerStorage } from './common/throttler/throttler-storage.factory';
import { configuration } from './config/configuration';
import { validate } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.getOrThrow<string>('database.host'),
        port: config.getOrThrow<number>('database.port'),
        username: config.getOrThrow<string>('database.user'),
        password: config.getOrThrow<string>('database.password'),
        database: config.getOrThrow<string>('database.name'),
        autoLoadEntities: true,
        // Dev convenience only. Deployed environments run migrations instead.
        synchronize: config.getOrThrow<boolean>('database.synchronize'),
        logging: config.getOrThrow<boolean>('database.logging'),
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        // Default message leaks the exception class name to the client.
        errorMessage: 'Too many requests, please try again later',
        storage: await createThrottlerStorage(config),
        throttlers: [
          {
            name: 'default',
            ttl: config.getOrThrow<number>('rateLimit.ttlSeconds') * 1000,
            limit: config.getOrThrow<number>('rateLimit.max'),
          },
          // Credential endpoints opt into this one with @Throttle.
          {
            name: 'auth',
            ttl: config.getOrThrow<number>('rateLimit.authTtlSeconds') * 1000,
            limit: config.getOrThrow<number>('rateLimit.authMax'),
          },
        ],
      }),
    }),
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    // Global so a new route is rate limited by default rather than by memory.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
