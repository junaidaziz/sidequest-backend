import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { AdminMfaService } from '../admin-auth/admin-mfa.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminManagementService } from './admin-management.service';
import { PermissionResolverService } from './permission-resolver.service';

const ACTOR = {
  adminUserId: 'actor-1',
  email: 'owner@b.com',
  roleId: 'role-owner',
  sessionId: 's1',
  mfaPending: false,
  mustChangePassword: false,
};
const CTX = { ipAddress: '1.2.3.4', userAgent: 'jest' };

function adminRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'admin-2',
    email: 'a@b.com',
    displayName: 'Admin',
    status: 'Active',
    roleId: 'role-1',
    role: { id: 'role-1', key: 'support_agent' },
    mfaEnabledAt: null,
    mustChangePassword: false,
    lastLoginAt: null,
    lockedUntil: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AdminManagementService', () => {
  let prisma: {
    adminUser: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    adminSession: { updateMany: jest.Mock };
    role: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let email: { sendAdminInvite: jest.Mock };
  let adminAuth: { issueInviteToken: jest.Mock };
  let mfa: { reset: jest.Mock };
  let resolver: { hasAll: jest.Mock; bumpRoleVersion: jest.Mock };
  let service: AdminManagementService;

  beforeEach(() => {
    prisma = {
      adminUser: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      adminSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      role: { findUnique: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([adminRow({ status: 'Suspended' }), { count: 1 }]),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    email = { sendAdminInvite: jest.fn() };
    adminAuth = { issueInviteToken: jest.fn().mockResolvedValue('raw-token') };
    mfa = { reset: jest.fn() };
    resolver = { hasAll: jest.fn(), bumpRoleVersion: jest.fn() };
    service = new AdminManagementService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      email as unknown as EmailService,
      adminAuth as unknown as AdminAuthService,
      mfa as unknown as AdminMfaService,
      resolver as unknown as PermissionResolverService,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  describe('list / get', () => {
    it('lists non-deleted admins', async () => {
      prisma.adminUser.findMany.mockResolvedValue([adminRow()]);
      const list = await service.list();
      expect(list[0].roleKey).toBe('support_agent');
    });

    it('404s for a missing admin', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(null);
      await expect(service.get('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('invite', () => {
    it('400s when the role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(
        service.invite(ACTOR, { email: 'a@b.com', displayName: 'A', roleId: 'r' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a pending admin, issues a token, emails a link', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });
      prisma.adminUser.create.mockResolvedValue(adminRow({ status: 'Invited' }));
      const res = await service.invite(
        ACTOR,
        { email: 'a@b.com', displayName: 'A', roleId: 'role-1' },
        CTX,
      );
      expect(res.inviteToken).toBe('raw-token');
      expect(email.sendAdminInvite).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalled();
    });

    it('409s on a duplicate email', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });
      prisma.adminUser.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5',
        }),
      );
      await expect(
        service.invite(ACTOR, { email: 'a@b.com', displayName: 'A', roleId: 'role-1' }, CTX),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('404s for a missing admin', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(null);
      await expect(service.update(ACTOR, 'x', { displayName: 'B' }, CTX)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403s on a role change without roles.assign', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      resolver.hasAll.mockResolvedValue(false);
      await expect(
        service.update(ACTOR, 'admin-2', { roleId: 'role-9' }, CTX),
      ).rejects.toThrow(ForbiddenException);
    });

    it('400s when the new role does not exist', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      resolver.hasAll.mockResolvedValue(true);
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(
        service.update(ACTOR, 'admin-2', { roleId: 'role-9' }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('changes the role, bumps version, and audits as roles.assign', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      resolver.hasAll.mockResolvedValue(true);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-9' });
      prisma.adminUser.update.mockResolvedValue(adminRow({ roleId: 'role-9' }));
      await service.update(ACTOR, 'admin-2', { roleId: 'role-9' }, CTX);
      expect(resolver.bumpRoleVersion).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'roles.assign' }),
      );
    });

    it('updates the display name only without bumping version', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      prisma.adminUser.update.mockResolvedValue(adminRow({ displayName: 'New' }));
      await service.update(ACTOR, 'admin-2', { displayName: 'New' }, CTX);
      expect(resolver.bumpRoleVersion).not.toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('400s when disabling yourself', async () => {
      await expect(service.disable(ACTOR, ACTOR.adminUserId, CTX)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404s for a missing admin', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(null);
      await expect(service.disable(ACTOR, 'x', CTX)).rejects.toThrow(NotFoundException);
    });

    it('suspends and revokes sessions', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      const res = await service.disable(ACTOR, 'admin-2', CTX);
      expect(res.status).toBe('Suspended');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('resetMfa', () => {
    it('404s for a missing admin', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(null);
      await expect(service.resetMfa(ACTOR, 'x', CTX)).rejects.toThrow(NotFoundException);
    });

    it('resets MFA and revokes sessions', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      await service.resetMfa(ACTOR, 'admin-2', CTX);
      expect(mfa.reset).toHaveBeenCalledWith('admin-2');
      expect(prisma.adminSession.updateMany).toHaveBeenCalled();
    });
  });

  describe('revokeSessions', () => {
    it('404s for a missing admin', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(null);
      await expect(service.revokeSessions(ACTOR, 'x', CTX)).rejects.toThrow(NotFoundException);
    });

    it('revokes and audits', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      await service.revokeSessions(ACTOR, 'admin-2', CTX);
      expect(prisma.adminSession.updateMany).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalled();
    });
  });
});
