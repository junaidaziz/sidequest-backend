import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionResolverService } from './permission-resolver.service';
import { RoleService } from './role.service';

const ACTOR = {
  adminUserId: 'actor-1',
  email: 'o@b.com',
  roleId: 'r',
  sessionId: 's',
  mfaPending: false,
  mustChangePassword: false,
};
const CTX = { ipAddress: '1.2.3.4', userAgent: 'jest' };

describe('RoleService', () => {
  let prisma: {
    role: { findMany: jest.Mock; findFirst: jest.Mock };
    permission: { findMany: jest.Mock };
    rolePermission: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; buildRecord: jest.Mock };
  let resolver: { bumpRoleVersion: jest.Mock };
  let service: RoleService;

  beforeEach(() => {
    prisma = {
      role: { findMany: jest.fn(), findFirst: jest.fn() },
      permission: { findMany: jest.fn() },
      rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
      buildRecord: jest.fn().mockReturnValue({}),
    };
    resolver = { bumpRoleVersion: jest.fn() };
    service = new RoleService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      resolver as unknown as PermissionResolverService,
    );
  });

  describe('listRoles', () => {
    it('maps roles to their permission keys', async () => {
      prisma.role.findMany.mockResolvedValue([
        {
          id: 'r1',
          key: 'support_agent',
          name: 'Support',
          description: null,
          isSystem: false,
          mfaRequired: false,
          permissions: [{ permission: { key: 'users.view' } }],
        },
      ]);
      const roles = await service.listRoles();
      expect(roles[0].permissionKeys).toEqual(['users.view']);
    });
  });

  describe('listPermissions', () => {
    it('returns the catalog', async () => {
      prisma.permission.findMany.mockResolvedValue([
        { id: 'p1', key: 'users.view', description: 'd', category: 'Users' },
      ]);
      const perms = await service.listPermissions();
      expect(perms[0].key).toBe('users.view');
    });
  });

  describe('updateRolePermissions', () => {
    const dto = { permissionKeys: ['users.view'] };

    it('404s for a missing role', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      await expect(service.updateRolePermissions(ACTOR, 'x', dto, CTX)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403s for a system role', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r', isSystem: true, permissions: [] });
      await expect(service.updateRolePermissions(ACTOR, 'r', dto, CTX)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('400s when a permission key is unknown', async () => {
      prisma.role.findFirst.mockResolvedValue({ id: 'r', isSystem: false, permissions: [] });
      prisma.permission.findMany.mockResolvedValue([]); // none matched
      await expect(service.updateRolePermissions(ACTOR, 'r', dto, CTX)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('replaces the set, bumps version, and audits', async () => {
      prisma.role.findFirst.mockResolvedValue({
        id: 'r',
        key: 'support_agent',
        name: 'Support',
        description: null,
        isSystem: false,
        mfaRequired: false,
        permissions: [{ permission: { key: 'proofs.view' } }],
      });
      prisma.permission.findMany.mockResolvedValue([{ id: 'p1', key: 'users.view' }]);
      const res = await service.updateRolePermissions(ACTOR, 'r', dto, CTX);
      expect(res.permissionKeys).toEqual(['users.view']);
      expect(resolver.bumpRoleVersion).toHaveBeenCalled();
      expect(audit.buildRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'roles.manage' }),
      );
    });
  });
});
