import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AdminAuthService } from './admin-auth.service';
import { AdminLockoutService } from './admin-lockout.service';
import { AdminMfaService } from './admin-mfa.service';
import { AdminTokenService } from './admin-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit-log/audit-log.service';

const CTX = { ipAddress: '1.2.3.4', userAgent: 'jest' };
// bcrypt hash of the string "correct-password" (cost 12).
const PW_HASH = '$2b$12$2VbKh0Xi.A2UFLvcaNpmnOf93ikzPKWExYaNrrq8T0p7dtAelqCI6';

function tokenSet() {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    refreshTokenHash: 'hash',
    sessionId: 'session-1',
    expiresAt: new Date(Date.now() + 3_600_000),
  };
}

function adminRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'admin-1',
    email: 'a@b.com',
    displayName: 'Admin',
    passwordHash: PW_HASH,
    status: 'Active',
    deletedAt: null,
    lockedUntil: null,
    mfaEnabledAt: null,
    mustChangePassword: false,
    roleId: 'role-1',
    role: { id: 'role-1', key: 'support_agent', mfaRequired: false },
    ...overrides,
  };
}

describe('AdminAuthService', () => {
  let prisma: {
    adminUser: { findUnique: jest.Mock; update: jest.Mock };
    adminSession: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let redis: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let tokens: { issue: jest.Mock; verifyRefresh: jest.Mock; compareRefresh: jest.Mock };
  let mfa: { verifyLoginCode: jest.Mock; setup: jest.Mock; verifyAndEnable: jest.Mock };
  let lockout: { isLocked: jest.Mock; recordFailure: jest.Mock; recordSuccess: jest.Mock };
  let audit: { record: jest.Mock; buildRecordWith: jest.Mock };
  let email: { sendAdminPasswordReset: jest.Mock };
  let service: AdminAuthService;

  beforeEach(() => {
    prisma = {
      adminUser: { findUnique: jest.fn(), update: jest.fn() },
      adminSession: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockImplementation(async (input: unknown) => {
        if (typeof input === 'function') return (input as (tx: typeof prisma) => unknown)(prisma);
        return [];
      }),
    };
    redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
    tokens = {
      issue: jest.fn().mockResolvedValue(tokenSet()),
      verifyRefresh: jest.fn(),
      compareRefresh: jest.fn(),
    };
    mfa = { verifyLoginCode: jest.fn(), setup: jest.fn(), verifyAndEnable: jest.fn() };
    lockout = {
      isLocked: jest.fn().mockReturnValue(false),
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    };
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
      buildRecordWith: jest.fn().mockResolvedValue(undefined),
    };
    email = { sendAdminPasswordReset: jest.fn() };
    service = new AdminAuthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      tokens as unknown as AdminTokenService,
      mfa as unknown as AdminMfaService,
      lockout as unknown as AdminLockoutService,
      audit as unknown as AuditLogService,
      email as unknown as EmailService,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  describe('login', () => {
    const dto = { email: 'a@b.com', password: 'correct-password' };

    it('returns generic 401 + audits failure for an unknown account', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(null);
      await expect(service.login(dto, CTX)).rejects.toThrow(UnauthorizedException);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.auth.login', result: 'FAILURE' }),
      );
    });

    it('rejects a locked account with the generic error (no existence leak)', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminRow());
      lockout.isLocked.mockReturnValue(true);
      await expect(service.login(dto, CTX)).rejects.toThrow('Invalid email or password');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'account_locked', result: 'FAILURE' }),
      );
    });

    it('records a failure and 401s on a wrong password', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminRow());
      await expect(service.login({ ...dto, password: 'wrong' }, CTX)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(lockout.recordFailure).toHaveBeenCalledWith('admin-1');
    });

    it('issues tokens directly when MFA is not enrolled', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminRow());
      const res = await service.login(dto, CTX);
      expect(res.status).toBe('authenticated');
      expect(res.accessToken).toBe('access');
      expect(lockout.recordSuccess).toHaveBeenCalled();
      expect(prisma.adminSession.create).toHaveBeenCalled();
    });

    it('returns an MFA challenge (no tokens) when MFA is enrolled', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminRow({ mfaEnabledAt: new Date() }));
      const res = await service.login(dto, CTX);
      expect(res.status).toBe('mfa_required');
      expect(res.challengeId).toBeDefined();
      expect(res.accessToken).toBeUndefined();
      expect(redis.set).toHaveBeenCalled();
    });
  });

  describe('completeMfaChallenge', () => {
    const dto = { challengeId: 'c1', code: '123456' };

    it('401s with the generic error on an unknown/expired challenge', async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.completeMfaChallenge(dto, CTX)).rejects.toThrow(
        'Invalid or expired MFA challenge',
      );
    });

    it('consumes the challenge and 401s (generic) when the referenced admin is gone', async () => {
      redis.get.mockResolvedValue('admin-1');
      prisma.adminUser.findUnique.mockResolvedValue(null);
      await expect(service.completeMfaChallenge(dto, CTX)).rejects.toThrow(
        'Invalid or expired MFA challenge',
      );
      expect(redis.del).toHaveBeenCalled();
    });

    it('invalidates the challenge, audits failure, and returns the generic error on a bad code', async () => {
      redis.get.mockResolvedValue('admin-1');
      prisma.adminUser.findUnique.mockResolvedValue(adminRow({ mfaEnabledAt: new Date() }));
      mfa.verifyLoginCode.mockResolvedValue(false);
      await expect(service.completeMfaChallenge(dto, CTX)).rejects.toThrow(
        'Invalid or expired MFA challenge',
      );
      // A single wrong code deletes the challenge key (blocks distributed brute force).
      expect(redis.del).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.auth.mfa.challenge', result: 'FAILURE' }),
      );
    });

    it('issues tokens and consumes the challenge on success', async () => {
      redis.get.mockResolvedValue('admin-1');
      prisma.adminUser.findUnique.mockResolvedValue(adminRow({ mfaEnabledAt: new Date() }));
      mfa.verifyLoginCode.mockResolvedValue(true);
      const res = await service.completeMfaChallenge(dto, CTX);
      expect(res.accessToken).toBe('access');
      expect(redis.del).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const dto = { refreshToken: 'rt' };

    it('401s on an invalid token', async () => {
      tokens.verifyRefresh.mockRejectedValue(new Error('bad'));
      await expect(service.refresh(dto, CTX)).rejects.toThrow('Invalid refresh token');
    });

    it('401s when the session is revoked/expired/mismatched', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'admin-1', sid: 'session-1' });
      prisma.adminSession.findUnique.mockResolvedValue({
        adminUserId: 'admin-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
        refreshTokenHash: 'hash',
        adminUser: adminRow(),
      });
      await expect(service.refresh(dto, CTX)).rejects.toThrow('Invalid refresh token');
    });

    it('401s when the stored hash does not match', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'admin-1', sid: 'session-1' });
      prisma.adminSession.findUnique.mockResolvedValue({
        adminUserId: 'admin-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        refreshTokenHash: 'hash',
        adminUser: adminRow(),
      });
      tokens.compareRefresh.mockResolvedValue(false);
      await expect(service.refresh(dto, CTX)).rejects.toThrow('Invalid refresh token');
    });

    it('rotates the pair on success, keeping session identity', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'admin-1', sid: 'session-1' });
      prisma.adminSession.findUnique.mockResolvedValue({
        id: 'session-1',
        adminUserId: 'admin-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        refreshTokenHash: 'hash',
        adminUser: adminRow(),
      });
      tokens.compareRefresh.mockResolvedValue(true);
      const res = await service.refresh(dto, CTX);
      expect(res.accessToken).toBe('access');
      expect(tokens.issue).toHaveBeenCalledWith('admin-1', 'session-1');
      expect(prisma.adminSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ refreshTokenHash: 'hash', revokedAt: null }),
        }),
      );
    });

    it('revokes the session when a concurrent refresh wins the compare-and-swap', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'admin-1', sid: 'session-1' });
      prisma.adminSession.findUnique.mockResolvedValue({
        id: 'session-1',
        adminUserId: 'admin-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        refreshTokenHash: 'hash',
        adminUser: adminRow(),
      });
      tokens.compareRefresh.mockResolvedValue(true);
      prisma.adminSession.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      await expect(service.refresh(dto, CTX)).rejects.toThrow('Invalid refresh token');
      expect(prisma.adminSession.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revokes the session when its immediate predecessor is replayed sequentially', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'admin-1', sid: 'session-1' });
      prisma.adminSession.findUnique.mockResolvedValue({
        id: 'session-1',
        adminUserId: 'admin-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        refreshTokenHash: 'current-hash',
        refreshPreviousTokenHash: 'previous-hash',
        adminUser: adminRow(),
      });
      tokens.compareRefresh.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await expect(service.refresh(dto, CTX)).rejects.toThrow('Invalid refresh token');
      expect(prisma.adminSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', refreshTokenHash: 'current-hash', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does not revoke a session for arbitrary invalid token material', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'admin-1', sid: 'session-1' });
      prisma.adminSession.findUnique.mockResolvedValue({
        id: 'session-1',
        adminUserId: 'admin-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        refreshTokenHash: 'current-hash',
        refreshPreviousTokenHash: 'previous-hash',
        adminUser: adminRow(),
      });
      tokens.compareRefresh.mockResolvedValue(false);
      await expect(service.refresh(dto, CTX)).rejects.toThrow('Invalid refresh token');
      expect(prisma.adminSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('logout / logoutAll / sessions', () => {
    const auth = {
      adminUserId: 'admin-1',
      email: 'a@b.com',
      roleId: 'role-1',
      sessionId: 'session-1',
      mfaPending: false,
      mustChangePassword: false,
    };

    it('revokes the current session on logout', async () => {
      await service.logout(auth, CTX);
      expect(prisma.adminSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revokes all live sessions on logout-all', async () => {
      await service.logoutAll(auth, CTX);
      expect(prisma.adminSession.updateMany).toHaveBeenCalledWith({
        where: { adminUserId: 'admin-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('flags the current session in the sessions list', async () => {
      prisma.adminSession.findMany.mockResolvedValue([
        {
          id: 'session-1',
          userAgent: null,
          ipAddress: null,
          lastUsedAt: null,
          expiresAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        },
        {
          id: 'session-2',
          userAgent: null,
          ipAddress: null,
          lastUsedAt: null,
          expiresAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        },
      ]);
      const list = await service.listSessions(auth);
      expect(list.find((s) => s.id === 'session-1')?.current).toBe(true);
      expect(list.find((s) => s.id === 'session-2')?.current).toBe(false);
    });
  });

  describe('forgotPassword', () => {
    it('issues a token + emails on a known active account', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminRow());
      await service.forgotPassword({ email: 'a@b.com' }, CTX);
      expect(redis.set).toHaveBeenCalled();
      expect(email.sendAdminPasswordReset).toHaveBeenCalled();
    });

    it('does nothing (no leak) for an unknown account', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(null);
      await service.forgotPassword({ email: 'x@y.com' }, CTX);
      expect(email.sendAdminPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    // The token is `<adminId>.<random>`; the stored value is its sha256 hash.
    const rawToken = 'admin-1.some-random-token';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const dto = { token: rawToken, newPassword: 'Abcdefgh12!@' };

    it('400s on a malformed token (no admin-id prefix) without touching Redis', async () => {
      await expect(
        service.resetPassword({ token: 'no-dot', newPassword: 'Abcdefgh12!@' }, CTX),
      ).rejects.toThrow(BadRequestException);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('400s when the stored hash does not match (stale/invalidated link)', async () => {
      redis.get.mockResolvedValue('a-different-hash');
      await expect(service.resetPassword(dto, CTX)).rejects.toThrow(BadRequestException);
    });

    it('sets a new password and revokes sessions on success', async () => {
      redis.get.mockResolvedValue(tokenHash);
      prisma.adminUser.findUnique.mockResolvedValue(adminRow());
      await service.resetPassword(dto, CTX);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith('admin:pwreset:admin-1');
    });
  });

  describe('acceptInvitation', () => {
    const dto = { token: 't', password: 'Abcdefgh12!@' };

    it('400s on an invalid invitation', async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.acceptInvitation('t', dto, CTX)).rejects.toThrow(BadRequestException);
    });

    it('400s when the account is not in Invited status', async () => {
      redis.get.mockResolvedValue('admin-1');
      prisma.adminUser.findUnique.mockResolvedValue(adminRow({ status: 'Active' }));
      await expect(service.acceptInvitation('t', dto, CTX)).rejects.toThrow(BadRequestException);
    });

    it('activates the account and auto-logs in via a single transaction', async () => {
      redis.get.mockResolvedValue('admin-1');
      prisma.adminUser.findUnique.mockResolvedValue(adminRow({ status: 'Invited' }));
      // The activation update + session insert run atomically in one $transaction.
      prisma.$transaction.mockResolvedValueOnce([adminRow({ status: 'Active' }), {}]);
      const res = await service.acceptInvitation('t', dto, CTX);
      expect(res.accessToken).toBe('access');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalled();
    });
  });

  describe('issueInviteToken', () => {
    it('stores a hashed token in Redis and returns the raw token', async () => {
      const raw = await service.issueInviteToken('admin-1');
      expect(raw).toEqual(expect.any(String));
      expect(redis.set).toHaveBeenCalled();
    });
  });

  describe('MFA orchestration', () => {
    const auth = {
      adminUserId: 'admin-1',
      email: 'a@b.com',
      roleId: 'role-1',
      sessionId: 'session-1',
      mfaPending: true,
      mustChangePassword: false,
    };

    it('setupMfa loads the admin, delegates, and audits', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminRow());
      mfa.setup.mockResolvedValue({ secret: 's', otpauthUrl: 'u' });
      const res = await service.setupMfa(auth, CTX);
      expect(res.secret).toBe('s');
      expect(audit.buildRecordWith).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'admin.auth.mfa.setup' }),
      );
    });

    it('verifyMfa returns recovery codes and audits', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(adminRow());
      mfa.verifyAndEnable.mockResolvedValue(['code1', 'code2']);
      const res = await service.verifyMfa(auth, '123456', CTX);
      expect(res.recoveryCodes).toHaveLength(2);
    });

    it('loadAdmin throws when the admin is missing', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(null);
      await expect(service.loadAdmin('x')).rejects.toThrow(UnauthorizedException);
    });
  });
});
