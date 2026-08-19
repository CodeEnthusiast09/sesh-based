import { Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CsrfGuard } from '../../common/guards/csrf.guard';
import { SessionGuard } from '../../common/guards/session.guard';
import { UsersModule } from '../users/users.module';
import { SessionEntity } from './entities/session.entity';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionCookieService } from './session-cookie.service';
import { SessionService } from './session.service';
import { SessionsController } from './sessions.controller';
import { PostgresSessionStore } from './stores/postgres-session.store';
import {
  createRedisClient,
  RedisSessionStore,
} from './stores/redis-session.store';
import {
  SESSION_STORE,
  type SessionStore,
} from './stores/session-store.interface';

/**
 * Builds only the backend named by SESSION_STORE, so running on Postgres does
 * not require Redis to be up, and vice versa. This factory is the single place
 * that knows which store is in use; nothing above it does.
 */
const sessionStoreProvider: Provider = {
  provide: SESSION_STORE,
  inject: [ConfigService, getRepositoryToken(SessionEntity)],
  useFactory: async (
    config: ConfigService,
    repository: Repository<SessionEntity>,
  ): Promise<SessionStore> => {
    if (config.getOrThrow<string>('session.store') !== 'redis') {
      return new PostgresSessionStore(repository);
    }

    const logger = new Logger(RedisSessionStore.name);
    const client = createRedisClient(config.getOrThrow<string>('redis.url'));

    // Without a listener, a dropped connection surfaces as an unhandled error
    // event and takes the process down.
    client.on('error', (error: Error) =>
      logger.error(`Redis connection error: ${error.message}`),
    );

    await client.connect();

    return new RedisSessionStore(
      client,
      config.getOrThrow<number>('session.rememberAbsoluteTtlSeconds'),
    );
  },
};

@Module({
  imports: [TypeOrmModule.forFeature([SessionEntity]), UsersModule],
  controllers: [SessionsController],
  providers: [
    sessionStoreProvider,
    SessionService,
    SessionCookieService,
    SessionCleanupService,
    SessionGuard,
    CsrfGuard,
  ],
  exports: [SessionService, SessionCookieService, SessionGuard, CsrfGuard],
})
export class SessionsModule {}
