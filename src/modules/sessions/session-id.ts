import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes = 256 bits of entropy, well past any feasible guessing attack. */
const TOKEN_BYTES = 32;

const randomToken = (): string =>
  randomBytes(TOKEN_BYTES).toString('base64url');

/**
 * SHA-256 rather than argon2 is correct here: the input is already 256 random
 * bits, so there is nothing to brute force. The slow-hash requirement applies
 * to low-entropy inputs like passwords, not to values we generated ourselves.
 */
export const hashSessionId = (rawId: string): string =>
  createHash('sha256').update(rawId).digest('hex');

export const generateSessionId = (): { raw: string; hashed: string } => {
  const raw = randomToken();

  return { raw, hashed: hashSessionId(raw) };
};

export const generateCsrfToken = (): string => randomToken();

/**
 * Compares two secrets without leaking, through timing, how much of the value
 * matched. Both sides are hashed first so the buffers are always the same
 * length, which avoids the early length check that would otherwise leak the
 * token's size and would make timingSafeEqual throw on a mismatch.
 */
export const constantTimeEquals = (left: string, right: string): boolean => {
  const digest = (value: string): Buffer =>
    createHash('sha256').update(value).digest();

  return timingSafeEqual(digest(left), digest(right));
};
