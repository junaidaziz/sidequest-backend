import { ConfigService } from '@nestjs/config';
import { AdminCryptoService } from './admin-crypto.service';

describe('AdminCryptoService', () => {
  const config = { getOrThrow: () => 'a-test-encryption-key' } as unknown as ConfigService;
  let service: AdminCryptoService;

  beforeEach(() => {
    service = new AdminCryptoService(config);
  });

  it('round-trips a plaintext value', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = service.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('throws on a malformed payload', () => {
    expect(() => service.decrypt('not-a-valid-payload')).toThrow('Malformed encrypted payload');
  });

  it('throws when the auth tag does not verify (tampered ciphertext)', () => {
    const encrypted = service.encrypt('secret');
    const parts = encrypted.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${Buffer.from('tampered').toString('base64')}`;
    expect(() => service.decrypt(tampered)).toThrow();
  });
});
