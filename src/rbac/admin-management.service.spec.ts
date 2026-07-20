import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
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
    role: { id: 'role-1', key: 'support_agent', mfaRequired: false },
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
    permission: { findUnique: jest.Mock };
    adminUserPermissionOverride: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let email: { sendAdminInvite: jest.Mock };
  let adminAuth: { issueInviteToken: jest.Mock };
  let mfa: { reset: jest.Mock };
  let resolver: {
    hasAll: jest.Mock;
    bumpRoleVersion: jest.Mock;
    getEffectivePermissions: jest.Mock;
  };
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
      permission: { findUnique: jest.fn() },
      adminUserPermissionOverride: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([adminRow({ status: 'Suspended' }), { count: 1 }]),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    email = { sendAdminInvite: jest.fn() };
    adminAuth = { issueInviteToken: jest.fn().mockResolvedValue('raw-token') };
    mfa = { reset: jest.fn() };
    resolver = {
      hasAll: jest.fn(),
      bumpRoleVersion: jest.fn(),
      getEffectivePermissions: jest.fn(),
    };
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

    it('creates a pending admin, issues a token, emails a link — but never returns the token', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });
      prisma.adminUser.create.mockResolvedValue(adminRow({ status: 'Invited' }));
      const res = await service.invite(
        ACTOR,
        { email: 'a@b.com', displayName: 'A', roleId: 'role-1' },
        CTX,
      );
      // The raw token is emailed only — it must NOT leak in the API response.
      expect((res as unknown as Record<string, unknown>).inviteToken).toBeUndefined();
      expect(res.id).toBe('admin-2');
      expect(adminAuth.issueInviteToken).toHaveBeenCalledWith('admin-2');
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
      await expect(service.update(ACTOR, 'admin-2', { roleId: 'role-9' }, CTX)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('400s when the new role does not exist', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      resolver.hasAll.mockResolvedValue(true);
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(service.update(ACTOR, 'admin-2', { roleId: 'role-9' }, CTX)).rejects.toThrow(
        BadRequestException,
      );
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

  describe('permission overrides', () => {
    const PERM = { id: 'perm-1', key: 'users.suspend' };
    function overrideRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'ovr-1',
        adminUserId: 'admin-2',
        permissionId: 'perm-1',
        effect: 'GRANT',
        reason: null,
        grantedByAdminId: 'actor-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    describe('listOverrides', () => {
      it('404s for a missing admin', async () => {
        prisma.adminUser.findFirst.mockResolvedValue(null);
        await expect(service.listOverrides('x')).rejects.toThrow(NotFoundException);
      });

      it('maps rows to DTOs with the permission key, never the internal id', async () => {
        prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-2' });
        prisma.adminUserPermissionOverride.findMany.mockResolvedValue([
          { ...overrideRow(), permission: PERM },
        ]);
        const list = await service.listOverrides('admin-2');
        expect(list).toHaveLength(1);
        expect(list[0].permissionKey).toBe('users.suspend');
        expect(list[0].effect).toBe('GRANT');
        expect((list[0] as unknown as Record<string, unknown>).permissionId).toBeUndefined();
      });
    });

    describe('upsertOverride', () => {
      it('404s for a missing admin', async () => {
        prisma.adminUser.findFirst.mockResolvedValue(null);
        await expect(
          service.upsertOverride(ACTOR, 'x', 'users.suspend', { effect: 'GRANT' }, CTX),
        ).rejects.toThrow(NotFoundException);
      });

      it('404s for an unknown permission key', async () => {
        prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-2' });
        prisma.permission.findUnique.mockResolvedValue(null);
        await expect(
          service.upsertOverride(ACTOR, 'admin-2', 'nope.key', { effect: 'GRANT' }, CTX),
        ).rejects.toThrow(NotFoundException);
      });

      it('creates a new override, bumps role-version, and audits as permissions.assign', async () => {
        prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-2' });
        prisma.permission.findUnique.mockResolvedValue(PERM);
        prisma.adminUserPermissionOverride.findUnique.mockResolvedValue(null);
        prisma.adminUserPermissionOverride.upsert.mockResolvedValue(
          overrideRow({ effect: 'GRANT', reason: 'needs export' }),
        );
        const res = await service.upsertOverride(
          ACTOR,
          'admin-2',
          'users.suspend',
          { effect: 'GRANT', reason: 'needs export' },
          CTX,
        );
        expect(res.permissionKey).toBe('users.suspend');
        expect(res.grantedByAdminId).toBe('actor-1');
        expect(resolver.bumpRoleVersion).toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'permissions.assign',
            targetType: 'AdminUser',
            targetId: 'admin-2',
            previousValue: null,
          }),
        );
      });

      it('updates the existing row (not a duplicate) on a repeat call, capturing the prior effect', async () => {
        prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-2' });
        prisma.permission.findUnique.mockResolvedValue(PERM);
        prisma.adminUserPermissionOverride.findUnique.mockResolvedValue(
          overrideRow({ effect: 'GRANT' }),
        );
        prisma.adminUserPermissionOverride.upsert.mockResolvedValue(
          overrideRow({ effect: 'REVOKE' }),
        );
        await service.upsertOverride(ACTOR, 'admin-2', 'users.suspend', { effect: 'REVOKE' }, CTX);
        // Upsert keyed by the compound unique constraint — one row per pair.
        expect(prisma.adminUserPermissionOverride.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              adminUserId_permissionId: { adminUserId: 'admin-2', permissionId: 'perm-1' },
            },
          }),
        );
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            previousValue: expect.objectContaining({ effect: 'GRANT' }),
          }),
        );
      });
    });

    describe('removeOverride', () => {
      it('404s for a missing admin', async () => {
        prisma.adminUser.findFirst.mockResolvedValue(null);
        await expect(service.removeOverride(ACTOR, 'x', 'users.suspend', CTX)).rejects.toThrow(
          NotFoundException,
        );
      });

      it('404s for an unknown permission key', async () => {
        prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-2' });
        prisma.permission.findUnique.mockResolvedValue(null);
        await expect(service.removeOverride(ACTOR, 'admin-2', 'nope.key', CTX)).rejects.toThrow(
          NotFoundException,
        );
      });

      it('is a no-op (no delete, no bump, no audit) when there is no override to remove', async () => {
        prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-2' });
        prisma.permission.findUnique.mockResolvedValue(PERM);
        prisma.adminUserPermissionOverride.findUnique.mockResolvedValue(null);
        const res = await service.removeOverride(ACTOR, 'admin-2', 'users.suspend', CTX);
        expect(res).toEqual({ removed: false });
        expect(prisma.adminUserPermissionOverride.delete).not.toHaveBeenCalled();
        expect(resolver.bumpRoleVersion).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      });

      it('deletes the row, bumps role-version, and audits when an override exists', async () => {
        prisma.adminUser.findFirst.mockResolvedValue({ id: 'admin-2' });
        prisma.permission.findUnique.mockResolvedValue(PERM);
        prisma.adminUserPermissionOverride.findUnique.mockResolvedValue(overrideRow());
        const res = await service.removeOverride(ACTOR, 'admin-2', 'users.suspend', CTX);
        expect(res).toEqual({ removed: true });
        expect(prisma.adminUserPermissionOverride.delete).toHaveBeenCalledWith({
          where: { id: 'ovr-1' },
        });
        expect(resolver.bumpRoleVersion).toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'permissions.assign' }),
        );
      });
    });
  });

  describe('getSelf', () => {
    it('401s when the calling admin no longer exists (deleted mid-session)', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(null);
      await expect(service.getSelf(ACTOR)).rejects.toThrow(UnauthorizedException);
    });

    it('returns the profile with sorted effective permissions, not gated by admins.view', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(adminRow());
      resolver.getEffectivePermissions.mockResolvedValue(new Set(['users.view', 'analytics.view']));
      const me = await service.getSelf(ACTOR);
      expect(resolver.getEffectivePermissions).toHaveBeenCalledWith('admin-2');
      expect(me.permissions).toEqual(['analytics.view', 'users.view']);
      expect(me.mfaEnrollmentRequired).toBe(false);
      expect(me.roleKey).toBe('support_agent');
    });

    it('flags mfaEnrollmentRequired when the role mandates MFA but none is enrolled yet', async () => {
      prisma.adminUser.findFirst.mockResolvedValue(
        adminRow({ role: { id: 'role-owner', key: 'owner', mfaRequired: true } }),
      );
      resolver.getEffectivePermissions.mockResolvedValue(new Set());
      const me = await service.getSelf(ACTOR);
      expect(me.mfaEnrollmentRequired).toBe(true);
    });
  });
});
