/**
 * Marks a throttler storage error that must not fail open. Fail-open exists so
 * a Redis outage does not take login down with it; it is not meant to swallow
 * a bug in this package's own script. This means Redis was reached and
 * responded, but with something the script did not expect, which will not fix
 * itself by retrying and needs to be loud rather than quietly disabling the
 * limiter.
 */
export class RateLimiterFaultError extends Error {
  constructor(cause: Error) {
    super(`rate limit counter fault: ${cause.message}`, { cause });
    this.name = 'RateLimiterFaultError';
  }
}
