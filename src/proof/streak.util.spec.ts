import { computeStreak, toUtcMidnight } from './streak.util';

describe('streak.util', () => {
  describe('toUtcMidnight', () => {
    it('strips the time-of-day, keeping the UTC calendar date', () => {
      const result = toUtcMidnight(new Date('2026-07-12T23:59:59.999Z'));
      expect(result.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('normalizes just-before-midnight and just-after to different days', () => {
      const before = toUtcMidnight(new Date('2026-07-12T23:59:59Z'));
      const after = toUtcMidnight(new Date('2026-07-13T00:00:01Z'));
      expect(before.toISOString()).toBe('2026-07-12T00:00:00.000Z');
      expect(after.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    });
  });

  describe('computeStreak — the four branches in isolation', () => {
    it('branch 1: no prior completion starts the streak at 1', () => {
      const result = computeStreak({
        now: new Date('2026-07-12T10:00:00Z'),
        lastCompletionDate: null,
        currentStreak: 0,
        longestStreak: 0,
      });

      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
      expect(result.lastCompletionDate.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('branch 2: a second completion the same UTC day leaves the streak unchanged', () => {
      const result = computeStreak({
        now: new Date('2026-07-12T20:00:00Z'),
        lastCompletionDate: new Date('2026-07-12T06:00:00Z'),
        currentStreak: 4,
        longestStreak: 9,
      });

      expect(result.currentStreak).toBe(4);
      expect(result.longestStreak).toBe(9);
      expect(result.lastCompletionDate.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('branch 3: completing exactly the next UTC day extends the streak by 1', () => {
      const result = computeStreak({
        now: new Date('2026-07-13T01:00:00Z'),
        lastCompletionDate: new Date('2026-07-12T22:00:00Z'),
        currentStreak: 4,
        longestStreak: 4,
      });

      expect(result.currentStreak).toBe(5);
      // running max advances with the extended streak
      expect(result.longestStreak).toBe(5);
      expect(result.lastCompletionDate.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    });

    it('branch 4a: a gap of 2+ days resets the streak to 1', () => {
      const result = computeStreak({
        now: new Date('2026-07-15T10:00:00Z'),
        lastCompletionDate: new Date('2026-07-12T10:00:00Z'),
        currentStreak: 6,
        longestStreak: 10,
      });

      expect(result.currentStreak).toBe(1);
      // longest is preserved across a reset
      expect(result.longestStreak).toBe(10);
      expect(result.lastCompletionDate.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    });

    it('branch 4b: a lastCompletionDate in the future (defensive) also resets to 1', () => {
      const result = computeStreak({
        now: new Date('2026-07-12T10:00:00Z'),
        lastCompletionDate: new Date('2026-07-20T10:00:00Z'),
        currentStreak: 3,
        longestStreak: 3,
      });

      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(3);
    });

    it('extending past the previous best raises longestStreak', () => {
      const result = computeStreak({
        now: new Date('2026-07-13T00:00:00Z'),
        lastCompletionDate: new Date('2026-07-12T00:00:00Z'),
        currentStreak: 3,
        longestStreak: 3,
      });

      expect(result.currentStreak).toBe(4);
      expect(result.longestStreak).toBe(4);
    });
  });
});
