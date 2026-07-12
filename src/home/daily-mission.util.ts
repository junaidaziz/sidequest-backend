/** Milliseconds in a UTC calendar day (no DST in UTC, so this is exact). */
const MS_PER_DAY = 86_400_000;

/**
 * Day-seed for the deterministic daily pick: whole UTC days since the Unix
 * epoch. The same value is returned for every instant within one UTC calendar
 * day and increments by exactly 1 at the next UTC midnight.
 */
export function daySeedFromDate(now: Date): number {
  return Math.floor(now.getTime() / MS_PER_DAY);
}

/**
 * Deterministically picks "today's" mission from a stably-ordered pool by
 * indexing with `daySeed % pool.length`. The caller supplies missions already
 * ordered by id so the choice is stable within a UTC day and rotates
 * predictably to the next mission the following day. Returns null for an empty
 * pool rather than erroring. Pure and side-effect-free so both the determinism
 * (same seed -> same index) and rotation (next seed -> next index) properties
 * are unit-tested in isolation from the service.
 */
export function pickDailyMission<T>(pool: T[], daySeed: number): T | null {
  if (pool.length === 0) {
    return null;
  }
  // `% length` is non-negative here because daySeed (days since 1970) is
  // non-negative for any realistic clock; guard defensively anyway.
  const index = ((daySeed % pool.length) + pool.length) % pool.length;
  return pool[index];
}
