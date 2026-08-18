import { SessionRecord } from '../session.types';

/** DI token. The concrete implementation is chosen by SESSION_STORE in env. */
export const SESSION_STORE = Symbol('SESSION_STORE');

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;

  /** Must return null for sessions past either expiry clock. */
  findById(id: string): Promise<SessionRecord | null>;

  /** Slides the idle clock. Never touches the absolute clock. */
  touch(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;

  delete(id: string): Promise<void>;

  /** Returns how many were removed. `exceptId` supports "log out everywhere else". */
  deleteByUser(userId: string, exceptId?: string): Promise<number>;

  /** Live sessions only, most recently seen first. */
  listByUser(userId: string): Promise<SessionRecord[]>;

  /** Housekeeping for stores without native expiry. Returns how many were removed. */
  deleteExpired(): Promise<number>;
}
