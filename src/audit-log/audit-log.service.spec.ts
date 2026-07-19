import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import { AuditResult } from './types/audit';

describe('AuditLogService', () => {
  let prisma: {
    auditLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: AuditLogService;

  beforeEach(() => {
    prisma = {
      auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new AuditLogService(prisma as unknown as PrismaService);
  });

  describe('record', () => {
    it('folds result + reason into newValue under reserved keys', async () => {
      await service.record({
        actorAdminUserId: 'admin-1',
        action: 'admins.manage',
        targetType: 'AdminUser',
        targetId: 'admin-2',
        newValue: { email: 'x@y.com' },
        result: AuditResult.Success,
        reason: 'a-note',
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      });
      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data.adminUserId).toBe('admin-1');
      expect(data.newValue).toEqual({ email: 'x@y.com', __result: 'SUCCESS', __reason: 'a-note' });
    });

    it('builds newValue from meta only when no domain value is supplied', async () => {
      await service.record({
        actorAdminUserId: null,
        action: 'admin.auth.login',
        result: AuditResult.Failure,
      });
      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data.newValue).toEqual({ __result: 'FAILURE' });
      expect(data.adminUserId).toBeNull();
    });

    it('wraps a non-object domain value under a `value` key', async () => {
      await service.record({
        actorAdminUserId: 'a',
        action: 'x',
        newValue: 'scalar',
        result: AuditResult.Success,
      });
      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data.newValue).toEqual({ value: 'scalar', __result: 'SUCCESS' });
    });

    it('never throws when the DB write fails (best-effort)', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.record({ actorAdminUserId: 'a', action: 'x', result: AuditResult.Success }),
      ).resolves.toBeUndefined();
    });
  });

  describe('buildRecord', () => {
    it('returns the un-awaited create promise for transaction enlistment', async () => {
      const promise = service.buildRecord({
        actorAdminUserId: 'admin-1',
        action: 'cms.edit',
        targetType: 'CmsFaq',
        targetId: 'faq-1',
        newValue: { id: 'faq-1', __verb: 'create' },
        result: AuditResult.Success,
      });
      // It delegates to prisma.auditLog.create (whose mock returns a promise).
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data.action).toBe('cms.edit');
      expect(data.targetId).toBe('faq-1');
      await expect(promise).resolves.toBeDefined();
    });

    it('does NOT swallow errors (unlike record) so a failed audit rolls back its tx', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.buildRecord({ actorAdminUserId: 'a', action: 'x', result: AuditResult.Success }),
      ).rejects.toThrow('db down');
    });
  });

  describe('list', () => {
    it('applies filters, pagination, and maps entries', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          {
            id: 'log-1',
            adminUserId: 'a',
            action: 'admins.manage',
            targetType: 'AdminUser',
            targetId: 't',
            previousValue: null,
            newValue: { __result: 'SUCCESS' },
            ipAddress: null,
            userAgent: null,
            createdAt: new Date(),
          },
        ],
        1,
      ]);

      const page = await service.list({
        page: 2,
        pageSize: 10,
        actorAdminUserId: 'a',
        targetType: 'AdminUser',
        action: 'admins.manage',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-12-31T00:00:00.000Z',
      });

      expect(page.total).toBe(1);
      expect(page.page).toBe(2);
      expect(page.items[0].id).toBe('log-1');
      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0];
      expect(findManyArgs.skip).toBe(10);
      expect(findManyArgs.take).toBe(10);
      expect(findManyArgs.where.adminUserId).toBe('a');
      expect(findManyArgs.where.createdAt.gte).toBeInstanceOf(Date);
      expect(findManyArgs.where.createdAt.lte).toBeInstanceOf(Date);
    });

    it('applies defaults and an empty where when no filters are given', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      const page = await service.list({});
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({});
      expect(findManyArgs.skip).toBe(0);
    });
  });
});
