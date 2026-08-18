/**
 * Duration strings in .env are written as `<number><unit>`, e.g. `30m`, `24h`, `30d`.
 * Restricted to s/m/h/d so the exact same strings parse in the Go sibling project,
 * where Go's time.ParseDuration is given the same treatment (it has no `d` unit).
 */
const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

export const DURATION_REGEX = DURATION_PATTERN;

/** Parses a duration string into whole seconds. Throws on anything malformed. */
export const parseDurationSeconds = (value: string): number => {
  const match = DURATION_PATTERN.exec(value);

  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Expected a number followed by s, m, h, or d (e.g. "30m").`,
    );
  }

  return Number(match[1]) * UNIT_SECONDS[match[2]];
};
