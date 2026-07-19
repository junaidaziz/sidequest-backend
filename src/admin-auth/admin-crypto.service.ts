import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM encryption for TOTP secrets at rest (Phase 4). The plaintext base32
 * secret must never be stored — a DB compromise would otherwise hand an attacker
 * every admin's second factor. The key comes from ADMIN_MFA_ENCRYPTION_KEY and is
 * normalized to 32 bytes via SHA-256 so any sufficiently-random env value works
 * (hex, base64, or a long passphrase).
 *
 * Ciphertext format: base64(iv).base64(authTag).base64(ciphertext) — a single
 * self-describing string stored in AdminUser.mfaSecret.
 */
@Injectable()
export class AdminCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.getOrThrow<string>('ADMIN_MFA_ENCRYPTION_KEY');
    // Normalize to a 32-byte key regardless of the env value's encoding/length.
    this.key = createHash('sha256').update(raw).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted payload');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
