import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminTokenType } from '../types/admin-jwt-payload.interface';
import { AdminJwtStrategy } from './admin-jwt.strategy';

const config = { getOrThrow: () => 'test-secret' } as unknown as ConfigService;

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    adminUserId: 'admin-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    adminUser: {
      id: 'admin-1',
      email: 'a@b.com',
      roleId: 'role-1',
      deletedAt: null as Date | null,
      status: 'Active' as string,
      lockedUntil: null as Date | null,
      mfaEnabledAt: null as Date | null,
      mustChangePassword: false,
      role: { mfaRequired: false as boolean },
    },
    ...overrides,
  };
}

describe('AdminJwtStrategy', () => {
  let prisma: { adminSession: { findUnique: jest.Mock; update: jest.Mock } };
  let strategy: AdminJwtStrategy;

  beforeEach(() => {
    prisma = {
      adminSession: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    strategy = new AdminJwtStrategy(config, prisma as unknown as PrismaService);
  });

  const access = (sid = 'session-1') => ({
    sub: 'admin-1',
    sid,
    type: AdminTokenType.Access,
  });

  it('rejects a non-access token', async () => {
    await expect(
      strategy.validate({ sub: 'admin-1', sid: 's', type: AdminTokenType.Refresh }),
    ).rejects.toThrow('Invalid token type');
  });

  it('rejects when the session is missing', async () => {
    prisma.adminSession.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(access())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a revoked session', async () => {
    prisma.adminSession.findUnique.mockResolvedValue(session({ revokedAt: new Date() }));
    await expect(strategy.validate(access())).rejects.toThrow('revoked');
  });

  it('rejects an expired session', async () => {
    prisma.adminSession.findUnique.mockResolvedValue(
      session({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(strategy.validate(access())).rejects.toThrow('revoked or expired');
  });

  it('rejects a suspended admin', async () => {
    const s = session();
    s.adminUser.status = 'Suspended';
    prisma.adminSession.findUnique.mockResolvedValue(s);
    await expect(strategy.validate(access())).rejects.toThrow('not active');
  });

  it('rejects a locked admin', async () => {
    const s = session();
    s.adminUser.lockedUntil = new Date(Date.now() + 60_000);
    prisma.adminSession.findUnique.mockResolvedValue(s);
    await expect(strategy.validate(access())).rejects.toThrow('locked');
  });

  it('returns the principal and derives mfaPending from the DB', async () => {
    const s = session();
    s.adminUser.role.mfaRequired = true; // required but not enrolled
    prisma.adminSession.findUnique.mockResolvedValue(s);
    const result = await strategy.validate(access());
    expect(result.adminUserId).toBe('admin-1');
    expect(result.sessionId).toBe('session-1');
    expect(result.mfaPending).toBe(true);
  });
});
