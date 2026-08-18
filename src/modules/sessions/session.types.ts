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

/**
 * What a session looks like over the wire. The csrfToken is deliberately absent:
 * listing your devices must never hand out another session's CSRF token.
 *
 * `id` is the stored SHA-256, which is safe to expose because it cannot be
 * reversed into the cookie value that would actually authenticate.
 */
export interface PublicSession {
  id: string;
  current: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent: string | null;
  ip: string | null;
  rememberMe: boolean;
}

export const toPublicSession = (
  session: SessionRecord,
  currentId: string,
): PublicSession => ({
  id: session.id,
  current: session.id === currentId,
  createdAt: session.createdAt,
  lastSeenAt: session.lastSeenAt,
  idleExpiresAt: session.idleExpiresAt,
  absoluteExpiresAt: session.absoluteExpiresAt,
  userAgent: session.userAgent,
  ip: session.ip,
  rememberMe: session.rememberMe,
});
