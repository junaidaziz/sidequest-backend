import { NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsService } from './notifications.service';

const USER = 'user-1';

function baseNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    userId: USER,
    type: NotificationType.task_accepted,
    title: 'Task accepted',
    body: 'Your task was accepted.',
    data: { screen: 'task-detail', taskId: 't-1' },
    readAt: null,
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    pushToken: { upsert: jest.Mock; deleteMany: jest.Mock };
    notificationPreference: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let queue: { enqueuePushDelivery: jest.Mock };

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      pushToken: { upsert: jest.fn(), deleteMany: jest.fn() },
      notificationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    queue = { enqueuePushDelivery: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      queue as unknown as NotificationsQueueService,
    );
  });

  describe('list', () => {
    it('returns a newest-first paginated page with defaults applied', async () => {
      prisma.notification.findMany.mockResolvedValue([baseNotification()]);
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.list(USER, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER },
          orderBy: { createdAt: 'desc' },
          take: 20,
          skip: 0,
        }),
      );
      expect(result).toMatchObject({ total: 1, limit: 20, offset: 0 });
      expect(result.items[0].id).toBe('notif-1');
    });

    it('filters to unread rows when unreadOnly is set', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await service.list(USER, { unreadOnly: true, limit: 5, offset: 10 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, readAt: null }, take: 5, skip: 10 }),
      );
    });

    it('maps a null data payload to null in the response', async () => {
      prisma.notification.findMany.mockResolvedValue([baseNotification({ data: null })]);
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.list(USER, {});

      expect(result.items[0].data).toBeNull();
    });
  });

  describe('getUnreadCount', () => {
    it('counts only unread rows for the caller', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount(USER);

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: USER, readAt: null },
      });
      expect(result).toEqual({ unreadCount: 3 });
    });
  });

  describe('markRead', () => {
    it("throws NotFound when the notification is not the caller's", async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead(USER, 'notif-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('sets readAt on an unread notification', async () => {
      prisma.notification.findFirst.mockResolvedValue(baseNotification());
      prisma.notification.update.mockResolvedValue(baseNotification({ readAt: new Date() }));

      const result = await service.markRead(USER, 'notif-1');

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'notif-1' }, data: { readAt: expect.any(Date) } }),
      );
      expect(result.readAt).not.toBeNull();
    });

    it('is idempotent for an already-read notification (no second write)', async () => {
      prisma.notification.findFirst.mockResolvedValue(
        baseNotification({ readAt: new Date('2026-07-14T01:00:00.000Z') }),
      );

      const result = await service.markRead(USER, 'notif-1');

      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(result.readAt).toEqual(new Date('2026-07-14T01:00:00.000Z'));
    });
  });

  describe('markAllRead', () => {
    it('marks every unread row read and reports the count', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });

      const result = await service.markAllRead(USER);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(result).toEqual({ updated: 4 });
    });
  });

  describe('registerPushToken', () => {
    it('upserts on (userId, token), clearing disabledAt on re-register', async () => {
      prisma.pushToken.upsert.mockResolvedValue({
        id: 'pt-1',
        token: 'tok',
        platform: 'ios',
        deviceId: 'dev',
        createdAt: new Date('2026-07-14T00:00:00.000Z'),
        updatedAt: new Date('2026-07-14T00:00:00.000Z'),
      });

      const result = await service.registerPushToken(USER, {
        token: 'tok',
        platform: 'ios',
        deviceId: 'dev',
      });

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_token: { userId: USER, token: 'tok' } },
          update: { platform: 'ios', deviceId: 'dev', disabledAt: null },
        }),
      );
      expect(result).toMatchObject({ id: 'pt-1', token: 'tok', platform: 'ios' });
    });

    it('coerces a missing deviceId to null', async () => {
      prisma.pushToken.upsert.mockResolvedValue({
        id: 'pt-1',
        token: 'tok',
        platform: 'android',
        deviceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.registerPushToken(USER, { token: 'tok', platform: 'android' });

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ deviceId: null }),
        }),
      );
    });
  });

  describe('deregisterPushToken', () => {
    it("deletes the caller's token and reports how many rows were removed", async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.deregisterPushToken(USER, 'tok');

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER, token: 'tok' },
      });
      expect(result).toEqual({ success: true, removed: 1 });
    });

    it('reports removed=0 (idempotent) when the token was already gone', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.deregisterPushToken(USER, 'tok');

      expect(result).toEqual({ success: true, removed: 0 });
    });
  });

  describe('deregisterAllPushTokens (M22.2 account deletion)', () => {
    it('removes every token for the user and reports the count', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.deregisterAllPushTokens(USER);

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
      expect(result).toEqual({ success: true, removed: 3 });
    });

    it('is idempotent — reports removed=0 when the user had no tokens', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.deregisterAllPushTokens(USER);

      expect(result).toEqual({ success: true, removed: 0 });
    });
  });

  describe('getPreferences', () => {
    it('returns the persisted preference row when it exists', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        pushEnabled: false,
        taskEventsEnabled: true,
        referralEventsEnabled: false,
        accountEventsEnabled: true,
      });

      const result = await service.getPreferences(USER);

      expect(result).toEqual({
        pushEnabled: false,
        taskEventsEnabled: true,
        referralEventsEnabled: false,
        accountEventsEnabled: true,
      });
    });

    it('returns all-enabled defaults without writing when no row exists', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);

      const result = await service.getPreferences(USER);

      expect(result).toEqual({
        pushEnabled: true,
        taskEventsEnabled: true,
        referralEventsEnabled: true,
        accountEventsEnabled: true,
      });
      expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updatePreferences', () => {
    it('upserts only the supplied flags', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue({
        pushEnabled: true,
        taskEventsEnabled: false,
        referralEventsEnabled: true,
        accountEventsEnabled: true,
      });

      const result = await service.updatePreferences(USER, { taskEventsEnabled: false });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER },
          create: { userId: USER, taskEventsEnabled: false },
          update: { taskEventsEnabled: false },
        }),
      );
      expect(result.taskEventsEnabled).toBe(false);
    });

    it('applies every supplied flag in the patch', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue({
        pushEnabled: false,
        taskEventsEnabled: false,
        referralEventsEnabled: false,
        accountEventsEnabled: false,
      });

      await service.updatePreferences(USER, {
        pushEnabled: false,
        taskEventsEnabled: false,
        referralEventsEnabled: false,
        accountEventsEnabled: false,
      });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            pushEnabled: false,
            taskEventsEnabled: false,
            referralEventsEnabled: false,
            accountEventsEnabled: false,
          },
        }),
      );
    });
  });

  describe('notify (producer)', () => {
    it('writes the in-app row then enqueues push delivery', async () => {
      prisma.notification.create.mockResolvedValue(baseNotification({ id: 'n-9' }));

      await service.notify({
        userId: USER,
        type: NotificationType.task_accepted,
        title: 'T',
        body: 'B',
        data: { screen: 'task-detail', taskId: 't-1' },
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER,
            type: NotificationType.task_accepted,
            data: { screen: 'task-detail', taskId: 't-1' },
          }),
        }),
      );
      expect(queue.enqueuePushDelivery).toHaveBeenCalledWith('n-9');
    });

    it('stores JSON null when no data payload is supplied', async () => {
      prisma.notification.create.mockResolvedValue(baseNotification({ id: 'n-10', data: null }));

      await service.notify({
        userId: USER,
        type: NotificationType.account_event,
        title: 'T',
        body: 'B',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ data: Prisma.JsonNull }),
        }),
      );
    });

    it('swallows an enqueue failure — the in-app row is still the source of truth', async () => {
      prisma.notification.create.mockResolvedValue(baseNotification({ id: 'n-11' }));
      queue.enqueuePushDelivery.mockRejectedValue(new Error('redis down'));

      await expect(
        service.notify({
          userId: USER,
          type: NotificationType.task_approved,
          title: 'T',
          body: 'B',
        }),
      ).resolves.toBeUndefined();
    });

    it('swallows a non-Error enqueue rejection too', async () => {
      prisma.notification.create.mockResolvedValue(baseNotification({ id: 'n-12' }));
      queue.enqueuePushDelivery.mockRejectedValue('redis string failure');

      await expect(
        service.notify({
          userId: USER,
          type: NotificationType.task_approved,
          title: 'T',
          body: 'B',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
