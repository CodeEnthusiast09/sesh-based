/**
 * Storage-agnostic session record. The Postgres and Redis stores both read and
 * write this shape, which is what lets them be swapped by env without anything
 * upstream noticing.
 *
 * `id` is the SHA-256 of the raw session ID that went into the cookie. The raw
 * value is never stored, so a database dump yields no usable sessions.
 */
export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  /** Slides forward on every authenticated request. */
  idleExpiresAt: Date;
  /** Fixed at creation and never extended. Caps the life of a stolen cookie. */
  absoluteExpiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  rememberMe: boolean;
}

export const isExpired = (session: SessionRecord, now: Date): boolean =>
  session.idleExpiresAt <= now || session.absoluteExpiresAt <= now;

export const addSeconds = (from: Date, seconds: number): Date =>
  new Date(from.getTime() + seconds * 1000);
