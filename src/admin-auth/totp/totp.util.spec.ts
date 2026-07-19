import {
  base32Encode,
  buildOtpAuthUrl,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from './totp.util';

describe('totp.util', () => {
  describe('generateTotpSecret', () => {
    it('produces a base32 string of the expected length', () => {
      const secret = generateTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      // 20 bytes -> 160 bits -> 32 base32 chars.
      expect(secret.length).toBe(32);
    });

    it('honours a custom byte length', () => {
      expect(generateTotpSecret(10).length).toBe(16);
    });
  });

  describe('base32Encode', () => {
    it('encodes known vectors (RFC 4648)', () => {
      expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    });
  });

  describe('buildOtpAuthUrl', () => {
    it('embeds the secret, issuer, and account label', () => {
      const url = buildOtpAuthUrl('ABCDEF', 'admin@example.com', 'SideQuest Admin');
      expect(url).toContain('otpauth://totp/');
      expect(url).toContain('secret=ABCDEF');
      expect(url).toContain('issuer=SideQuest+Admin');
      expect(url).toContain(encodeURIComponent('SideQuest Admin:admin@example.com'));
    });
  });

  describe('verifyTotp / generateTotp', () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000;

    it('accepts a freshly generated code', () => {
      const code = generateTotp(secret, at);
      expect(verifyTotp(secret, code, 1, at)).toBe(true);
    });

    it('accepts a code within the +/- window (clock skew)', () => {
      const previousStep = generateTotp(secret, at - 30);
      expect(verifyTotp(secret, previousStep, 1, at)).toBe(true);
    });

    it('rejects a code outside the window', () => {
      const stale = generateTotp(secret, at - 300);
      expect(verifyTotp(secret, stale, 1, at)).toBe(false);
    });

    it('rejects malformed (non-6-digit) input', () => {
      expect(verifyTotp(secret, '12345', 1, at)).toBe(false);
      expect(verifyTotp(secret, 'abcdef', 1, at)).toBe(false);
    });

    it('rejects when the secret decodes to empty (invalid base32)', () => {
      expect(verifyTotp('!!!!', '123456', 1, at)).toBe(false);
    });
  });
});
