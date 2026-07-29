import { validateSync } from 'class-validator';
import { IsIanaTimeZone, isIanaTimeZone } from './is-iana-timezone.validator';

class TimeZoneHolder {
  @IsIanaTimeZone()
  tz!: string;
}

describe('isIanaTimeZone', () => {
  it('accepts real IANA zone names', () => {
    expect(isIanaTimeZone('America/New_York')).toBe(true);
    expect(isIanaTimeZone('Europe/Paris')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
    expect(isIanaTimeZone('Pacific/Kiritimati')).toBe(true);
  });

  it('rejects an unknown zone name', () => {
    expect(isIanaTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isIanaTimeZone('Not/AZone')).toBe(false);
  });

  it('rejects the empty string (an unset timezone is handled by the DB default, not this path)', () => {
    expect(isIanaTimeZone('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isIanaTimeZone(undefined)).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(42)).toBe(false);
    expect(isIanaTimeZone({})).toBe(false);
  });
});

describe('@IsIanaTimeZone decorator', () => {
  it('passes validation for a real zone', () => {
    const holder = new TimeZoneHolder();
    holder.tz = 'America/New_York';
    expect(validateSync(holder)).toHaveLength(0);
  });

  it('fails validation with an IANA-mentioning message for an unknown zone', () => {
    const holder = new TimeZoneHolder();
    holder.tz = 'Not/AZone';
    const errors = validateSync(holder);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isIanaTimeZone).toContain('IANA timezone');
  });
});
