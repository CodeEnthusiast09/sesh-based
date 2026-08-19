# Session auth: NestJS and Go, side by side

Two implementations of the same design, built to be read against each other.
`sesh-based` is NestJS + TypeORM; `sesh-based-go` is Gin + GORM. Same routes,
same response envelope, same cookie flags, same two expiry clocks, and a schema
that comes out identical column for column.

The same `scripts/smoke.sh` runs against both (only the port differs) and passes
all 21 checks on both Postgres and Redis. Neither implementation was written to
satisfy the other's tests, so that is real evidence they behave the same.

## What actually happens on login

1. Verify the password with argon2id. If the email is unknown, verify against a
   decoy hash anyway so both paths cost the same time.
2. Generate 32 random bytes from the CSPRNG. That string goes in the cookie.
3. Store `sha256(that string)` as the primary key. The raw value is never
   persisted, so a database dump yields nothing usable.
4. Record two deadlines: `idle_expires_at` (slides on activity) and
   `absolute_expires_at` (never moves).
5. Generate a second random value as the CSRF token, stored on the session.
6. Retire whatever session arrived on the request, then set two cookies: the
   session ID (HttpOnly) and the CSRF token (deliberately not HttpOnly).

On every later request: read the cookie, hash it, look it up, reject if either
clock has passed, confirm the owner still exists, slide the idle clock.

## File mapping

| Concern | NestJS | Go |
|---|---|---|
| Env loading + validation | `config/configuration.ts`, `config/env.validation.ts` | `internal/config/config.go` |
| Duration parsing (s/m/h/d) | `config/duration.ts` | `internal/config/duration.go` |
| Response envelope | `common/utils/response.helper.ts` | `internal/response/response.go` |
| Error mapping | `common/filters/all-exceptions.filter.ts` | per-handler + `internal/middleware/recovery.go` |
| User model | `modules/users/entities/user.entity.ts` | `internal/models/user.go` |
| Session model | `modules/sessions/entities/session.entity.ts` | `internal/models/session.go` |
| Store interface | `stores/session-store.interface.ts` | `internal/session/store.go` |
| Postgres store | `stores/postgres-session.store.ts` | `internal/session/store_postgres.go` |
| Redis store | `stores/redis-session.store.ts` | `internal/session/store_redis.go` |
| Backend selection | factory in `sessions.module.ts` | `internal/session/store_factory.go` |
| Session policy | `modules/sessions/session.service.ts` | `internal/session/service.go` |
| Cookie flags | `session-cookie.service.ts` | `internal/session/cookie.go` |
| ID + CSRF crypto | `modules/sessions/session-id.ts` | `internal/session/token.go` |
| Auth guard | `common/guards/session.guard.ts` | `RequireSession` in `internal/session/middleware.go` |
| CSRF guard | `common/guards/csrf.guard.ts` | `RequireCSRF` in `internal/session/middleware.go` |
| Password hashing | `modules/auth/password.service.ts` | `internal/auth/password.go` |
| Expired-row sweep | `session-cleanup.service.ts` | `internal/session/cleanup.go` |
| Rate limiting | `@nestjs/throttler` in `app.module.ts` | `internal/middleware/ratelimit.go` |

## Where they genuinely differ, and why

**One struct or two.** TypeScript needed a plain `SessionRecord` separate from
the TypeORM entity, because decorators are executable code: importing the entity
would drag TypeORM into the Redis store. Go struct tags are inert strings, so
`models.Session` carries both `gorm:` and `json:` tags and serves both backends
directly. Fewer moving parts on the Go side, purely because of how the two
languages express metadata.

**Keeping the hash out of responses.** TypeORM has `select: false`, which stops
the column being read from the database at all unless a query asks for it. GORM
has no equivalent, so Go relies on `json:"-"` plus an explicit `Public()`
projection. The TypeScript version is stronger: it protects logs and error dumps
too, not just JSON serialisation.

**Where session middleware lives.** In Nest, guards are classes resolved by the
DI container, so `SessionGuard` sits in `common/guards` and Nest wires it up. Go
has no such container: the middleware needs `*session.Service` and the handlers
need to read what it stores, so splitting them across packages would be an import
cycle. It lives in `internal/session/middleware.go`, and the package owns its own
HTTP adapter, which is the idiomatic Go answer.

**Config validation.** Nest validates with class-validator decorators before the
config factory runs. Go accumulates problems in a small `loader` struct. Both
report every problem at once and refuse to boot; the Go version is about 40 lines
of plain code where the Nest version is decorators plus a `validate()` hook.

**Reading env in a decorator.** Nest hit a real wall here: decorator arguments
are evaluated when a module is imported, which happens before `.env` is loaded,
so `@MinLength(Number(process.env.X))` reads `undefined` forever. It needed a
custom lazy validator. Go has no such problem, since the check is just an `if` in
the handler.

**Duration strings.** Both accept `30m`, `24h`, `30d`. Go's `time.ParseDuration`
has no day unit and would also accept `1h30m` and `1.5h`, so the Go parser is
deliberately restricted to match the TypeScript regex exactly. There is a test
asserting the compound and float forms are rejected, so the two cannot drift.

## The Redis gotcha, in both languages

Sessions live at `session:<hash>` with a TTL set to whichever clock runs out
first, plus `user_sessions:<userId>` as a set so listing and revoking work.

When Redis expires a session key it **leaves that ID in the set**, because Redis
cannot cascade. Nothing else prunes it, so `listByUser` has to, or the set grows
forever. Both implementations do this, and both have a test that fails if the
pruning is removed.

Postgres has the opposite shape: a foreign key with `ON DELETE CASCADE` handles
user deletion for free, but there is no native expiry, so a background sweeper
removes rows that reads were already filtering out.

## Why not a library

`express-session` gives you `get/set/destroy/touch` keyed by session ID and no
way to ask "which sessions belong to user X". `gin-contrib/sessions` is a
per-request key-value bag with the same limitation, and its headline example
stores session data *in the cookie*, which is not server-side sessions at all.

Three of the four features here (rotation, list-and-revoke, per-session CSRF)
require reaching around both libraries, so neither earns its place. Hand-rolled
means the plumbing only. Every part that is actually cryptography uses vetted
code: argon2id for passwords, the platform CSPRNG for IDs, constant-time
comparison for tokens.

## Rate limiting

Two limiters in each project: a generous default on every route, and a much
stricter one on `/auth/register` and `/auth/login`, which are the brute-force and
credential-stuffing targets. All four values come from env. Both return the same
envelope with `error: "TooManyRequests"`.

Nest uses `@nestjs/throttler` with a global `APP_GUARD`, so a new route is limited
by default rather than by someone remembering. Go uses a hand-rolled fixed-window
counter keyed by client IP, with a background sweep evicting finished windows so
the map cannot grow forever.

**Both are in-memory**, so each instance counts only its own traffic: behind a
load balancer the effective limit is the configured value times the instance
count. Moving the counters into Redis is what fixes that, and is worth doing
before either is load balanced.

## Known gaps in both

- Schema is created by `synchronize` / `AutoMigrate`, which is a development
  convenience. Deployed environments need versioned migrations.
- `X-Forwarded-For` is not trusted, so the recorded IP is the proxy's address
  behind a load balancer until that is configured. That also means the rate
  limiter would key every request behind a proxy to the same bucket.
