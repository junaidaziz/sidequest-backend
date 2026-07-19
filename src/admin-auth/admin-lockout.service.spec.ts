import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AdminLockoutService, MAX_FAILED_ATTEMPTS } from './admin-lockout.service';

describe('AdminLockoutService', () => {
  let redis: { incr: jest.Mock; expire: jest.Mock; del: jest.Mock };
  let prisma: { adminUser: { findUnique: jest.Mock; update: jest.Mock } };
  let service: AdminLockoutService;

  beforeEach(() => {
    redis = { incr: jest.fn(), expire: jest.fn(), del: jest.fn() };
    prisma = { adminUser: { findUnique: jest.fn(), update: jest.fn() } };
    service = new AdminLockoutService(
      redis as unknown as RedisService,
      prisma as unknown as PrismaService,
    );
  });

  describe('isLocked', () => {
    it('is true only for a future lockedUntil', () => {
      expect(service.isLocked(new Date(Date.now() + 60_000))).toBe(true);
      expect(service.isLocked(new Date(Date.now() - 60_000))).toBe(false);
      expect(service.isLocked(null)).toBe(false);
    });
  });

  describe('recordFailure', () => {
    it('increments the counter and sets a TTL on the first failure', async () => {
      redis.incr.mockResolvedValue(1);
      prisma.adminUser.findUnique.mockResolvedValue({ failedLoginCount: 0 });
      await service.recordFailure('admin-1');
      expect(redis.expire).toHaveBeenCalled();
      const data = prisma.adminUser.update.mock.calls[0][0].data;
      expect(data.failedLoginCount).toBe(1);
      expect(data.lockedUntil).toBeUndefined();
    });

    it('sets lockedUntil once the threshold is reached', async () => {
      redis.incr.mockResolvedValue(MAX_FAILED_ATTEMPTS);
      prisma.adminUser.findUnique.mockResolvedValue({ failedLoginCount: MAX_FAILED_ATTEMPTS - 1 });
      await service.recordFailure('admin-1');
      const data = prisma.adminUser.update.mock.calls[0][0].data;
      expect(data.lockedUntil).toBeInstanceOf(Date);
    });

    it('locks using the durable counter even if Redis is unavailable', async () => {
      redis.incr.mockRejectedValue(new Error('redis down'));
      prisma.adminUser.findUnique.mockResolvedValue({ failedLoginCount: MAX_FAILED_ATTEMPTS - 1 });
      await service.recordFailure('admin-1');
      const data = prisma.adminUser.update.mock.calls[0][0].data;
      expect(data.failedLoginCount).toBe(MAX_FAILED_ATTEMPTS);
      expect(data.lockedUntil).toBeInstanceOf(Date);
    });
  });

  describe('recordSuccess', () => {
    it('clears both counters and stamps lastLoginAt', async () => {
      redis.del.mockResolvedValue(1);
      await service.recordSuccess('admin-1');
      const data = prisma.adminUser.update.mock.calls[0][0].data;
      expect(data.failedLoginCount).toBe(0);
      expect(data.lockedUntil).toBeNull();
      expect(data.lastLoginAt).toBeInstanceOf(Date);
    });

    it('still resets the durable counter when Redis del fails', async () => {
      redis.del.mockRejectedValue(new Error('redis down'));
      await service.recordSuccess('admin-1');
      expect(prisma.adminUser.update).toHaveBeenCalled();
    });
  });
});
