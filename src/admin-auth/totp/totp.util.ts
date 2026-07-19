import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Dependency-free RFC 6238 TOTP + RFC 4648 base32, implemented on Node's `crypto`
 * so the admin MFA flow needs no external package (no otplib/speakeasy). TOTP is
 * HMAC-SHA1, 6 digits, 30s step — the near-universal authenticator-app default
 * (Google Authenticator, 1Password, Authy).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const STEP_SECONDS = 30;

/** Generates a fresh base32 TOTP secret (default 20 bytes = 160 bits, per RFC 4226). */
export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

/**
 * Builds the `otpauth://` provisioning URI an authenticator app scans. `issuer`
 * and `accountName` are percent-encoded; the secret is the base32 string.
 */
export function buildOtpAuthUrl(secret: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Verifies a candidate 6-digit code against the secret, accepting codes within
 * `window` steps on either side of now (default ±1 = ~90s tolerance for clock
 * skew). Comparison is timing-safe. Returns false for malformed input.
 */
export function verifyTotp(secret: string, token: string, window = 1, atSeconds?: number): boolean {
  if (!/^\d{6}$/.test(token)) {
    return false;
  }
  const key = base32Decode(secret);
  if (key.length === 0) {
    return false;
  }
  const nowSeconds = atSeconds ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSeconds / STEP_SECONDS);
  const candidate = Buffer.from(token, 'utf8');
  for (let offset = -window; offset <= window; offset++) {
    const expected = Buffer.from(hotp(key, counter + offset), 'utf8');
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * Generates the current 6-digit TOTP code for a secret. Primarily a test/helper
 * utility (the server verifies codes, it never issues them to users), but exposed
 * so callers and tests can produce a valid code deterministically via `atSeconds`.
 */
export function generateTotp(secret: string, atSeconds?: number): string {
  const key = base32Decode(secret);
  const nowSeconds = atSeconds ?? Math.floor(Date.now() / 1000);
  return hotp(key, Math.floor(nowSeconds / STEP_SECONDS));
}

/** RFC 4226 HOTP for a single counter value, returned as a zero-padded 6-digit string. */
function hotp(key: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // Write the 64-bit counter big-endian; JS bitwise is 32-bit so split hi/lo.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      return Buffer.alloc(0);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
