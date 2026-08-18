import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SessionGuard } from '../../common/guards/session.guard';
import { UsersModule } from '../users/users.module';
import { SessionEntity } from './entities/session.entity';
import { SessionCookieService } from './session-cookie.service';
import { SessionService } from './session.service';
import { PostgresSessionStore } from './stores/postgres-session.store';
import { SESSION_STORE } from './stores/session-store.interface';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEntity]), UsersModule],
  providers: [
    PostgresSessionStore,
    { provide: SESSION_STORE, useExisting: PostgresSessionStore },
    SessionService,
    SessionCookieService,
    SessionGuard,
  ],
  exports: [SessionService, SessionCookieService, SessionGuard],
})
export class SessionsModule {}
