import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PublicUser, toPublicUser } from '../users/user.types';
import { UsersService } from '../users/users.service';
import {
  generateCsrfToken,
  generateSessionId,
  hashSessionId,
} from './session-id';
import { addSeconds, SessionRecord } from './session.types';
import {
  SESSION_STORE,
  type SessionStore,
} from './stores/session-store.interface';

export interface SessionContext {
  userAgent: string | null;
  ip: string | null;
  rememberMe: boolean;
}

export interface IssuedSession {
  rawId: string;
  session: SessionRecord;
  maxAgeSeconds: number;
}

export interface ResolvedSession {
  session: SessionRecord;
  user: PublicUser;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async issue(userId: string, context: SessionContext): Promise<IssuedSession> {
    const now = new Date();
    const { idleTtl, absoluteTtl } = this.ttlsFor(context.rememberMe);
    const { raw, hashed } = generateSessionId();

    const session: SessionRecord = {
      id: hashed,
      userId,
      csrfToken: generateCsrfToken(),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: addSeconds(now, idleTtl),
      absoluteExpiresAt: addSeconds(now, absoluteTtl),
      userAgent: context.userAgent,
      ip: context.ip,
      rememberMe: context.rememberMe,
    };

    await this.store.create(session);

    return { rawId: raw, session, maxAgeSeconds: absoluteTtl };
  }

  /**
   * Looks the session up by hash, confirms the owner still exists, then slides
   * the idle clock. Returns null for anything expired, unknown or orphaned.
   */
  async resolve(rawId: string): Promise<ResolvedSession | null> {
    const id = hashSessionId(rawId);
    const session = await this.store.findById(id);

    if (!session) {
      return null;
    }

    const user = await this.users.findById(session.userId);

    if (!user) {
      // Owner was deleted while the session was live. Clean it up rather than
      // leaving a session pointing at nothing.
      await this.store.delete(id);

      return null;
    }

    const now = new Date();
    const idleExpiresAt = addSeconds(
      now,
      this.ttlsFor(session.rememberMe).idleTtl,
    );

    await this.store.touch(id, now, idleExpiresAt);

    return {
      session: { ...session, lastSeenAt: now, idleExpiresAt },
      user: toPublicUser(user),
    };
  }

  async destroy(rawId: string): Promise<void> {
    await this.store.delete(hashSessionId(rawId));
  }

  async listForUser(userId: string): Promise<SessionRecord[]> {
    return this.store.listByUser(userId);
  }

  async revokeOthers(userId: string, currentId: string): Promise<number> {
    return this.store.deleteByUser(userId, currentId);
  }

  private ttlsFor(rememberMe: boolean): {
    idleTtl: number;
    absoluteTtl: number;
  } {
    return rememberMe
      ? {
          idleTtl: this.config.getOrThrow<number>(
            'session.rememberIdleTtlSeconds',
          ),
          absoluteTtl: this.config.getOrThrow<number>(
            'session.rememberAbsoluteTtlSeconds',
          ),
        }
      : {
          idleTtl: this.config.getOrThrow<number>('session.idleTtlSeconds'),
          absoluteTtl: this.config.getOrThrow<number>(
            'session.absoluteTtlSeconds',
          ),
        };
  }
}
