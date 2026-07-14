import {
  generateReferralCode,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from './referral-code.util';

describe('generateReferralCode', () => {
  it('produces a code of the default length', () => {
    expect(generateReferralCode()).toHaveLength(REFERRAL_CODE_LENGTH);
  });

  it('honours a custom length', () => {
    expect(generateReferralCode(12)).toHaveLength(12);
  });

  it('only uses characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateReferralCode();
      for (const ch of code) {
        expect(REFERRAL_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it('excludes visually confusable characters (0, O, 1, I, L)', () => {
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(REFERRAL_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('is non-deterministic across calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateReferralCode()));
    // Collisions across 50 draws from a ~8.5e11 space are astronomically unlikely.
    expect(codes.size).toBe(50);
  });
});
