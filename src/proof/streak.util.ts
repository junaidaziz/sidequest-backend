/** Milliseconds in a calendar day. Streak day-diffs are computed over
 * midnight-normalized "civil date" instants (see `civilDayToUtcMidnight`), which
 * are DST-free by construction, so this multiplier stays exact. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fallback zone when a user has no timezone set — preserves the prior UTC-day behaviour. */
const DEFAULT_TIME_ZONE = 'UTC';

/** Streak-relevant state read off the User row plus the moment of completion. */
export interface StreakInput {
  now: Date;
  lastCompletionDate: Date | null;
  currentStreak: number;
  longestStreak: number;
  /**
   * IANA timezone name (e.g. "America/New_York") the streak's calendar day is
   * measured in. Omitted/empty/invalid falls back to UTC, which reproduces the
   * previous pure-UTC behaviour exactly.
   */
  timeZone?: string | null;
}

/** New streak fields to persist after a completion. */
export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  /**
   * The completion's LOCAL calendar day, canonicalized to that civil date's UTC
   * midnight (e.g. local 2026-07-12 -> 2026-07-12T00:00:00.000Z regardless of
   * zone), to store as `lastCompletionDate`. Storing the civil date this way is
   * timezone-agnostic on read-back and keeps day-diff math a simple subtraction.
   */
  lastCompletionDate: Date;
}

/** Normalizes any instant to that day's UTC midnight, dropping the time-of-day. */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The civil (wall-clock) calendar date of `date` as seen in `timeZone`,
 * canonicalized to that date's UTC midnight. e.g. an instant that is
 * 2026-07-12 23:30 in "America/New_York" (2026-07-13 03:30 UTC) maps to
 * 2026-07-12T00:00:00.000Z — the LOCAL day, not the UTC day.
 *
 * An unset or unrecognized `timeZone` falls back to UTC, so the result is
 * identical to `toUtcMidnight` and existing users see no behaviour change.
 */
export function civilDayToUtcMidnight(date: Date, timeZone?: string | null): Date {
  const zone = timeZone && timeZone.length > 0 ? timeZone : DEFAULT_TIME_ZONE;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    return new Date(Date.UTC(year, month - 1, day));
  } catch {
    // Unknown IANA zone (RangeError from Intl) — degrade to UTC rather than throw
    // and fail an otherwise-valid proof submission on a bad stored timezone.
    return toUtcMidnight(date);
  }
}

/**
 * Flat local-calendar-day streak rules (see User.currentStreak in schema.prisma).
 * Days are the user's LOCAL calendar days in `input.timeZone` (defaulting to UTC):
 *   - no prior completion            -> streak starts at 1
 *   - same local day as last         -> unchanged (a 2nd completion today still
 *                                       awards XP but neither extends nor resets)
 *   - exactly the next local day     -> extended by 1
 *   - a gap of 2+ days, or a date in
 *     the past (defensive)           -> reset to 1
 * longestStreak is the running max; lastCompletionDate becomes today's local
 * civil date (canonicalized to UTC midnight — see `civilDayToUtcMidnight`).
 *
 * Pure and side-effect-free so it is unit-tested in isolation from the service.
 */
export function computeStreak(input: StreakInput): StreakResult {
  const today = civilDayToUtcMidnight(input.now, input.timeZone);

  let currentStreak: number;
  if (input.lastCompletionDate === null) {
    currentStreak = 1;
  } else {
    // `lastCompletionDate` is already a canonicalized civil date (UTC midnight of
    // the local day it was stored on), so re-applying the timezone shift would
    // move it across the day boundary and corrupt the diff. Just strip any stray
    // time-of-day defensively; do NOT timezone-convert a value that is already a
    // civil date.
    const last = toUtcMidnight(input.lastCompletionDate);
    const diffDays = Math.round((today.getTime() - last.getTime()) / MS_PER_DAY);

    if (diffDays === 0) {
      currentStreak = input.currentStreak;
    } else if (diffDays === 1) {
      currentStreak = input.currentStreak + 1;
    } else {
      currentStreak = 1;
    }
  }

  return {
    currentStreak,
    longestStreak: Math.max(input.longestStreak, currentStreak),
    lastCompletionDate: today,
  };
}
