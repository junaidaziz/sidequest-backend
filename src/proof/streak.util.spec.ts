import { civilDayToUtcMidnight, computeStreak, toUtcMidnight } from './streak.util';

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

  describe('civilDayToUtcMidnight — local calendar day', () => {
    it('defaults to the UTC day when no timezone is given', () => {
      const d = new Date('2026-07-12T23:30:00Z');
      expect(civilDayToUtcMidnight(d).toISOString()).toBe('2026-07-12T00:00:00.000Z');
      expect(civilDayToUtcMidnight(d, null).toISOString()).toBe('2026-07-12T00:00:00.000Z');
      expect(civilDayToUtcMidnight(d, '').toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('uses the local day: 23:30 UTC is still July 12 in New York', () => {
      // 2026-07-12T23:30Z is 19:30 on July 12 in America/New_York (UTC-4).
      const result = civilDayToUtcMidnight(new Date('2026-07-12T23:30:00Z'), 'America/New_York');
      expect(result.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('rolls the local day back across the UTC boundary: 02:00 UTC is still July 12 in New York', () => {
      // 2026-07-13T02:00Z is 22:00 on July 12 in America/New_York — the LOCAL day
      // is July 12 even though the UTC day is already July 13.
      const result = civilDayToUtcMidnight(new Date('2026-07-13T02:00:00Z'), 'America/New_York');
      expect(result.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('rolls the local day forward past UTC: 22:00 UTC is already July 13 in Tokyo', () => {
      // 2026-07-12T22:00Z is 07:00 on July 13 in Asia/Tokyo (UTC+9).
      const result = civilDayToUtcMidnight(new Date('2026-07-12T22:00:00Z'), 'Asia/Tokyo');
      expect(result.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    });

    it('falls back to UTC for an invalid timezone rather than throwing', () => {
      const result = civilDayToUtcMidnight(new Date('2026-07-12T23:30:00Z'), 'Not/AZone');
      expect(result.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });
  });

  describe('computeStreak — timezone-aware day boundaries', () => {
    it('does NOT extend when two completions fall on the same LOCAL day but different UTC days', () => {
      // New York user completes at 21:00 local July 12 (01:00Z July 13) then again
      // at 23:00 local July 12 (03:00Z July 13). Same local day → no change.
      const result = computeStreak({
        now: new Date('2026-07-13T03:00:00Z'),
        lastCompletionDate: civilDayToUtcMidnight(
          new Date('2026-07-13T01:00:00Z'),
          'America/New_York',
        ),
        currentStreak: 5,
        longestStreak: 5,
        timeZone: 'America/New_York',
      });

      expect(result.currentStreak).toBe(5);
      expect(result.lastCompletionDate.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    });

    it('extends across consecutive LOCAL days that share nothing in UTC', () => {
      // Previous completion stored on local July 12; new completion at 04:00Z
      // July 14 which is 00:00 local July 14 in New York → next day, extend.
      const result = computeStreak({
        now: new Date('2026-07-14T04:00:00Z'),
        lastCompletionDate: new Date('2026-07-13T00:00:00.000Z'),
        currentStreak: 2,
        longestStreak: 2,
        timeZone: 'America/New_York',
      });

      expect(result.currentStreak).toBe(3);
      // Stored as the new completion's LOCAL civil day (July 14 in New York).
      expect(result.lastCompletionDate.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    });

    it('reproduces the pure-UTC behaviour when timeZone is omitted', () => {
      const result = computeStreak({
        now: new Date('2026-07-13T01:00:00Z'),
        lastCompletionDate: new Date('2026-07-12T22:00:00Z'),
        currentStreak: 4,
        longestStreak: 4,
      });
      expect(result.currentStreak).toBe(5);
    });
  });
});
