#!/usr/bin/env bash
#
# Walks the full session lifecycle against a running server, using a real cookie
# jar so the session cookie survives between calls the way a browser's would.
#
#   npm run start:dev          # in another terminal
#   ./scripts/smoke.sh
#
# BASE_URL overrides the target. Exits non-zero on the first failed check.
#
# It spends about five requests against the credential endpoints, so running it
# more than twice inside AUTH_RATE_LIMIT_TTL trips the limiter and every check
# comes back 429. That is the limiter working, not a regression: wait out the
# window, raise AUTH_RATE_LIMIT_MAX for the run, or clear the counters
# (RATE_LIMIT_STORE=redis: redis-cli --scan --pattern 'throttle:*' | xargs redis-cli del).

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SESSION_COOKIE="${SESSION_COOKIE_NAME:-sid}"
CSRF_COOKIE="${CSRF_COOKIE_NAME:-csrf_token}"
CSRF_HEADER="${CSRF_HEADER_NAME:-x-csrf-token}"

JAR_DIR="$(mktemp -d)"
trap 'rm -rf "$JAR_DIR"' EXIT

EMAIL="smoke-$(date +%s)-$RANDOM@task141.mil"
PASSWORD="correct-horse-battery"
FAILURES=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

# check <description> <expected> <actual>
check() {
  if [ "$2" = "$3" ]; then
    printf '  %s %s\n' "$(green PASS)" "$1"
  else
    printf '  %s %s (expected %s, got %s)\n' "$(red FAIL)" "$1" "$2" "$3"
    FAILURES=$((FAILURES + 1))
  fi
}

# status <method> <path> [jar] [csrf] [body]
status() {
  local method="$1" path="$2" jar="${3:-}" csrf="${4:-}" body="${5:-}"
  local args=(-s -o /dev/null -w '%{http_code}' -X "$method" "$BASE_URL$path")
  [ -n "$jar" ]  && args+=(-b "$jar" -c "$jar")
  [ -n "$csrf" ] && args+=(-H "$CSRF_HEADER: $csrf")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}"
}

cookie_value() { grep -oP "$2\s+\K\S+$" "$1" 2>/dev/null | tail -1; }

json() { curl -s -b "$2" "$BASE_URL$1"; }

printf '\nTarget: %s\n' "$BASE_URL"

if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")" != "200" ]; then
  printf '%s server is not reachable at %s. Start it first.\n' "$(red 'ABORT')" "$BASE_URL"
  exit 1
fi

STORE=$(curl -s "$BASE_URL/health" >/dev/null && echo "${SESSION_STORE:-from .env}")
printf 'Store:  %s\n\n' "$STORE"

A="$JAR_DIR/deviceA"; B="$JAR_DIR/deviceB"
LOGIN_BODY="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"

echo "Registration"
check "new account is created" 201 \
  "$(status POST /auth/register '' '' "$LOGIN_BODY")"
check "the same email is refused" 409 \
  "$(status POST /auth/register '' '' "$LOGIN_BODY")"
check "a short password is refused" 400 \
  "$(status POST /auth/register '' '' "{\"email\":\"x-$EMAIL\",\"password\":\"short\"}")"

echo; echo "Login"
check "unauthenticated /auth/me is refused" 401 "$(status GET /auth/me)"
check "correct credentials succeed" 200 \
  "$(status POST /auth/login "$A" '' "$LOGIN_BODY")"
check "a wrong password is refused" 401 \
  "$(status POST /auth/login '' '' "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}")"

SID_A=$(cookie_value "$A" "$SESSION_COOKIE")
CSRF_A=$(cookie_value "$A" "$CSRF_COOKIE")
check "a session cookie was issued" "yes" "$([ -n "$SID_A" ] && echo yes || echo no)"
check "a CSRF cookie was issued"    "yes" "$([ -n "$CSRF_A" ] && echo yes || echo no)"
check "/auth/me now succeeds" 200 "$(status GET /auth/me "$A")"

echo; echo "CSRF"
check "a write with no token is refused"    403 "$(status POST /auth/logout "$A")"
check "a write with a bad token is refused" 403 "$(status POST /auth/logout "$A" 'wrong-token')"
check "reads never need a token"            200 "$(status GET /sessions "$A")"

echo; echo "Multiple devices"
check "a second device can sign in" 200 \
  "$(status POST /auth/login "$B" '' "$LOGIN_BODY")"
check "both sessions are listed" 2 \
  "$(json /sessions "$A" | grep -o '"id"' | wc -l)"
check "exactly one is marked current" 1 \
  "$(json /sessions "$A" | grep -o '"current":true' | wc -l)"
check "the CSRF token is never listed" 0 \
  "$(json /sessions "$A" | grep -c 'csrfToken')"

echo; echo "Revocation"
SID_B_HASH=$(printf '%s' "$(cookie_value "$B" "$SESSION_COOKIE")" | sha256sum | cut -d' ' -f1)
check "device A revokes device B" 200 \
  "$(status DELETE "/sessions/$SID_B_HASH" "$A" "$CSRF_A")"
check "device B is signed out"    401 "$(status GET /auth/me "$B")"
check "device A is unaffected"    200 "$(status GET /auth/me "$A")"

echo; echo "Logout"
check "logout with a valid token succeeds" 200 \
  "$(status POST /auth/logout "$A" "$CSRF_A")"
check "the session no longer works"        401 "$(status GET /auth/me "$A")"

echo
if [ "$FAILURES" -eq 0 ]; then
  printf '%s all checks passed\n\n' "$(green 'OK')"
  exit 0
fi

printf '%s %d check(s) failed\n\n' "$(red 'FAILED')" "$FAILURES"
exit 1
