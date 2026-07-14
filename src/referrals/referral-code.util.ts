import { randomInt } from 'crypto';

/**
 * Unambiguous alphabet: uppercase letters + digits, with the visually confusable
 * characters removed (0/O, 1/I/L) so a code read off a screen and typed by a
 * friend can't be mistranscribed. 31 symbols; an 8-char code is ~31^8 ≈ 8.5e11
 * possibilities, so collisions are rare — but ReferralService still retries on
 * the (unique-constrained) collision rather than trusting probability.
 */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Length of a generated referral code. */
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Generates a random referral code from {@link REFERRAL_CODE_ALPHABET}. Uses
 * `crypto.randomInt` (rejection-sampled, unbiased) rather than `Math.random`,
 * so no character is over-represented — a mild defence against a code being
 * easier to guess than its keyspace implies.
 */
export function generateReferralCode(length: number = REFERRAL_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}
