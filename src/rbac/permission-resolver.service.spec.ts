import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PermissionResolverService } from './permission-resolver.service';

describe('PermissionResolverService', () => {
  let prisma: { adminUser: { findUnique: jest.Mock } };
  let redis: { incr: jest.Mock; get: jest.Mock; set: jest.Mock };
  let service: PermissionResolverService;

  beforeEach(() => {
    prisma = { adminUser: { findUnique: jest.fn() } };
    redis = { incr: jest.fn(), get: jest.fn(), set: jest.fn() };
    service = new PermissionResolverService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  function adminWith(rolePerms: string[], overrides: { key: string; effect: string }[] = []) {
    return {
      role: { permissions: rolePerms.map((key) => ({ permission: { key } })) },
      permissionOverrides: overrides.map((o) => ({
        effect: o.effect,
        permission: { key: o.key },
      })),
    };
  }

  describe('getEffectivePermissions', () => {
    it('returns the cached set on a hit (no DB read)', async () => {
      redis.get
        .mockResolvedValueOnce('3') // version
        .mockResolvedValueOnce(JSON.stringify(['users.view'])); // cache hit
      const set = await service.getEffectivePermissions('admin-1');
      expect([...set]).toEqual(['users.view']);
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
    });

    it('computes role ∪ GRANT − REVOKE on a miss and caches it', async () => {
      redis.get
        .mockResolvedValueOnce('0') // version
        .mockResolvedValueOnce(null); // cache miss
      prisma.adminUser.findUnique.mockResolvedValue(
        adminWith(
          ['users.view', 'users.edit'],
          [
            { key: 'users.export', effect: 'GRANT' },
            { key: 'users.edit', effect: 'REVOKE' },
          ],
        ),
      );
      const set = await service.getEffectivePermissions('admin-1');
      expect([...set].sort()).toEqual(['users.export', 'users.view']);
      expect(redis.set).toHaveBeenCalled();
    });

    it('returns an empty set when the admin is missing', async () => {
      redis.get.mockResolvedValueOnce('0').mockResolvedValueOnce(null);
      prisma.adminUser.findUnique.mockResolvedValue(null);
      expect((await service.getEffectivePermissions('x')).size).toBe(0);
    });

    it('falls back to a DB compute when Redis reads throw', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      redis.set.mockRejectedValue(new Error('redis down'));
      prisma.adminUser.findUnique.mockResolvedValue(adminWith(['audit.view']));
      const set = await service.getEffectivePermissions('admin-1');
      expect([...set]).toEqual(['audit.view']);
    });
  });

  describe('hasAll', () => {
    it('short-circuits true for an empty requirement', async () => {
      expect(await service.hasAll('admin-1', [])).toBe(true);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('requires every listed key (ALL semantics)', async () => {
      redis.get.mockResolvedValue(null);
      prisma.adminUser.findUnique.mockResolvedValue(adminWith(['users.view', 'users.edit']));
      expect(await service.hasAll('admin-1', ['users.view', 'users.edit'])).toBe(true);
      expect(await service.hasAll('admin-1', ['users.view', 'users.delete'])).toBe(false);
    });
  });

  describe('bumpRoleVersion', () => {
    it('increments the counter', async () => {
      redis.incr.mockResolvedValue(1);
      await service.bumpRoleVersion();
      expect(redis.incr).toHaveBeenCalledWith('rbac:role-version');
    });

    it('does not throw when Redis is unavailable', async () => {
      redis.incr.mockRejectedValue(new Error('redis down'));
      await expect(service.bumpRoleVersion()).resolves.toBeUndefined();
    });
  });
});
