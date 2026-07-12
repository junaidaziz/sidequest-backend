/** Milliseconds in a UTC calendar day (no DST in UTC, so this is exact). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Streak-relevant state read off the User row plus the moment of completion. */
export interface StreakInput {
  now: Date;
  lastCompletionDate: Date | null;
  currentStreak: number;
  longestStreak: number;
}

/** New streak fields to persist after a completion. */
export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  /** UTC-midnight-normalized completion date to store as lastCompletionDate. */
  lastCompletionDate: Date;
}

/** Normalizes any instant to that day's UTC midnight, dropping the time-of-day. */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Flat UTC-calendar-day streak rules (see User.currentStreak in schema.prisma):
 *   - no prior completion            -> streak starts at 1
 *   - same UTC day as last           -> unchanged (a 2nd completion today still
 *                                       awards XP but neither extends nor resets)
 *   - exactly the next UTC day       -> extended by 1
 *   - a gap of 2+ days, or a date in
 *     the past (defensive)           -> reset to 1
 * longestStreak is the running max; lastCompletionDate becomes today's UTC date.
 *
 * Pure and side-effect-free so it is unit-tested in isolation from the service.
 */
export function computeStreak(input: StreakInput): StreakResult {
  const today = toUtcMidnight(input.now);

  let currentStreak: number;
  if (input.lastCompletionDate === null) {
    currentStreak = 1;
  } else {
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
