import { daySeedFromDate, pickDailyMission } from './daily-mission.util';

describe('daySeedFromDate', () => {
  it('returns the same seed for two instants within the same UTC day', () => {
    const morning = new Date('2026-07-12T00:00:01.000Z');
    const night = new Date('2026-07-12T23:59:59.000Z');
    expect(daySeedFromDate(morning)).toBe(daySeedFromDate(night));
  });

  it('increments the seed by exactly 1 at the next UTC midnight', () => {
    const today = new Date('2026-07-12T12:00:00.000Z');
    const tomorrow = new Date('2026-07-13T12:00:00.000Z');
    expect(daySeedFromDate(tomorrow) - daySeedFromDate(today)).toBe(1);
  });

  it('computes whole UTC days since the epoch (2026-07-12 -> 20646)', () => {
    // Math.floor(Date.parse('2026-07-12T00:00:00Z') / 86_400_000) === 20646
    expect(daySeedFromDate(new Date('2026-07-12T00:00:00.000Z'))).toBe(20646);
  });
});

describe('pickDailyMission', () => {
  const pool = ['a', 'b', 'c', 'd'];

  it('returns null for an empty pool rather than erroring', () => {
    expect(pickDailyMission([], 12345)).toBeNull();
  });

  it('is deterministic: the same day-seed yields the same mission', () => {
    expect(pickDailyMission(pool, 20646)).toBe(pickDailyMission(pool, 20646));
  });

  it('indexes by daySeed % pool.length', () => {
    // 20646 % 4 === 2 -> 'c'
    expect(pickDailyMission(pool, 20646)).toBe('c');
  });

  it('rotates to a different mission on the next day when the pool has >1 item', () => {
    const today = pickDailyMission(pool, 20646); // index 2 -> 'c'
    const tomorrow = pickDailyMission(pool, 20647); // index 3 -> 'd'
    expect(tomorrow).not.toBe(today);
    expect(tomorrow).toBe('d');
  });

  it('always returns the single mission for a pool of size 1, every day', () => {
    const single = ['only'];
    expect(pickDailyMission(single, 20646)).toBe('only');
    expect(pickDailyMission(single, 20647)).toBe('only');
  });

  it('wraps around after reaching the end of the pool', () => {
    // 20648 % 4 === 0 -> 'a' (wrapped back to the head)
    expect(pickDailyMission(pool, 20648)).toBe('a');
  });
});
