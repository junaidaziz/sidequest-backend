import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCryptoService } from './admin-crypto.service';
import { AdminMfaService } from './admin-mfa.service';
import { generateTotp } from './totp/totp.util';

function baseAdmin(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'admin-1',
    email: 'a@b.com',
    mfaSecret: null,
    mfaEnabledAt: null,
    ...overrides,
  } as AdminUser;
}

describe('AdminMfaService', () => {
  const crypto = new AdminCryptoService({
    getOrThrow: () => 'test-key',
  } as unknown as ConfigService);
  let prisma: {
    adminUser: { update: jest.Mock };
    adminMfaRecoveryCode: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: AdminMfaService;

  beforeEach(() => {
    prisma = {
      adminUser: { update: jest.fn().mockResolvedValue({}) },
      adminMfaRecoveryCode: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new AdminMfaService(prisma as unknown as PrismaService, crypto);
  });

  describe('setup', () => {
    it('stores an encrypted secret and returns the plaintext + otpauth url', async () => {
      const result = await service.setup(baseAdmin());
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.otpauthUrl).toContain('otpauth://totp/');
      const stored = prisma.adminUser.update.mock.calls[0][0].data.mfaSecret;
      expect(stored).not.toBe(result.secret);
      expect(crypto.decrypt(stored)).toBe(result.secret);
    });

    it('rejects when MFA is already enabled', async () => {
      await expect(service.setup(baseAdmin({ mfaEnabledAt: new Date() }))).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('verifyAndEnable', () => {
    it('enables MFA and returns 10 recovery codes for a valid code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const admin = baseAdmin({ mfaSecret: crypto.encrypt(secret) });
      const code = generateTotp(secret);
      const codes = await service.verifyAndEnable(admin, code);
      expect(codes).toHaveLength(10);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects an invalid code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const admin = baseAdmin({ mfaSecret: crypto.encrypt(secret) });
      await expect(service.verifyAndEnable(admin, '000000')).rejects.toThrow(BadRequestException);
    });

    it('rejects when setup was never started (no secret)', async () => {
      await expect(service.verifyAndEnable(baseAdmin(), '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when already enabled', async () => {
      await expect(
        service.verifyAndEnable(baseAdmin({ mfaEnabledAt: new Date() }), '123456'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyLoginCode', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    it('returns false for an admin without MFA enabled', async () => {
      expect(await service.verifyLoginCode(baseAdmin(), '123456')).toBe(false);
    });

    it('accepts a valid TOTP code', async () => {
      const admin = baseAdmin({ mfaSecret: crypto.encrypt(secret), mfaEnabledAt: new Date() });
      expect(await service.verifyLoginCode(admin, generateTotp(secret))).toBe(true);
    });

    it('falls back to and consumes a recovery code', async () => {
      const admin = baseAdmin({ mfaSecret: crypto.encrypt(secret), mfaEnabledAt: new Date() });
      // Only the raw code the test provides should match; simulate one stored code.
      const bcrypt = await import('bcrypt');
      // The service normalizes (strips hyphens, lowercases) before hashing AND
      // before comparing, so the stored hash is of the normalized code.
      const stored = await bcrypt.hash('abcdef123456', 4);
      prisma.adminMfaRecoveryCode.findMany.mockResolvedValue([{ id: 'rc-1', codeHash: stored }]);
      const ok = await service.verifyLoginCode(admin, 'ABCD-EF12-3456');
      expect(ok).toBe(true);
      expect(prisma.adminMfaRecoveryCode.update).toHaveBeenCalledWith({
        where: { id: 'rc-1' },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('returns false when no recovery code matches', async () => {
      const admin = baseAdmin({ mfaSecret: crypto.encrypt(secret), mfaEnabledAt: new Date() });
      prisma.adminMfaRecoveryCode.findMany.mockResolvedValue([]);
      expect(await service.verifyLoginCode(admin, 'zzzz-zzzz-zzzz')).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears MFA state in a transaction', async () => {
      await service.reset('admin-1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
