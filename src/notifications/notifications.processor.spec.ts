import { NotificationType } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsProcessor } from './notifications.processor';
import { CHECK_RECEIPTS_JOB, SEND_PUSH_JOB } from './notifications.constants';
import { PushProviderClient } from './push-provider.interface';

const NOTIFICATION_ID = 'notif-1';
const USER = 'user-1';

function sendJob(): Job {
  return { name: SEND_PUSH_JOB, data: { notificationId: NOTIFICATION_ID } } as unknown as Job;
}

function receiptsJob(data: unknown): Job {
  return { name: CHECK_RECEIPTS_JOB, data } as unknown as Job;
}

function baseNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIFICATION_ID,
    userId: USER,
    type: NotificationType.task_accepted,
    title: 'Task accepted',
    body: 'Your task was accepted.',
    data: { screen: 'task-detail', taskId: 't-1' },
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;
  let prisma: {
    notification: { findUnique: jest.Mock };
    notificationPreference: { findUnique: jest.Mock };
    pushToken: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let queue: { enqueueReceiptCheck: jest.Mock };
  let push: {
    isValidToken: jest.Mock;
    chunk: jest.Mock;
    send: jest.Mock;
    getReceipts: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      notification: { findUnique: jest.fn().mockResolvedValue(baseNotification()) },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      pushToken: {
        findMany: jest.fn().mockResolvedValue([{ token: 'ExponentPushToken[a]' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    queue = { enqueueReceiptCheck: jest.fn().mockResolvedValue(undefined) };
    push = {
      isValidToken: jest.fn().mockReturnValue(true),
      // Default: one chunk containing whatever was passed.
      chunk: jest.fn((messages) => [messages]),
      send: jest.fn(),
      getReceipts: jest.fn(),
    };
    processor = new NotificationsProcessor(
      prisma as unknown as PrismaService,
      queue as unknown as NotificationsQueueService,
      push as unknown as PushProviderClient,
    );
  });

  it('ignores an unknown job name', async () => {
    await processor.process({ name: 'mystery', data: {} } as unknown as Job);

    expect(prisma.notification.findUnique).not.toHaveBeenCalled();
  });

  describe('send-push', () => {
    it('skips when the notification no longer exists', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await processor.process(sendJob());

      expect(prisma.pushToken.findMany).not.toHaveBeenCalled();
    });

    it('skips when the user disabled push entirely', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        pushEnabled: false,
        taskEventsEnabled: true,
        referralEventsEnabled: true,
        accountEventsEnabled: true,
      });

      await processor.process(sendJob());

      expect(prisma.pushToken.findMany).not.toHaveBeenCalled();
    });

    it("skips when the notification's category is disabled", async () => {
      // task_accepted maps to taskEventsEnabled.
      prisma.notificationPreference.findUnique.mockResolvedValue({
        pushEnabled: true,
        taskEventsEnabled: false,
        referralEventsEnabled: true,
        accountEventsEnabled: true,
      });

      await processor.process(sendJob());

      expect(prisma.pushToken.findMany).not.toHaveBeenCalled();
    });

    it('delivers with the all-enabled default when no preference row exists', async () => {
      push.send.mockResolvedValue([{ status: 'ok', id: 'r-1' }]);

      await processor.process(sendJob());

      expect(push.send).toHaveBeenCalled();
      expect(queue.enqueueReceiptCheck).toHaveBeenCalledWith(['r-1'], {
        'r-1': 'ExponentPushToken[a]',
      });
    });

    it('skips when the user has no valid tokens', async () => {
      push.isValidToken.mockReturnValue(false);

      await processor.process(sendJob());

      expect(push.send).not.toHaveBeenCalled();
    });

    it('disables a token the send rejects as DeviceNotRegistered', async () => {
      push.send.mockResolvedValue([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);

      await processor.process(sendJob());

      expect(prisma.pushToken.updateMany).toHaveBeenCalledWith({
        where: { token: 'ExponentPushToken[a]', disabledAt: null },
        data: { disabledAt: expect.any(Date) },
      });
      // No ok tickets => no receipt-check scheduled.
      expect(queue.enqueueReceiptCheck).not.toHaveBeenCalled();
    });

    it('continues (no receipt check) when a chunk send throws', async () => {
      push.send.mockRejectedValue(new Error('network'));

      await processor.process(sendJob());

      expect(queue.enqueueReceiptCheck).not.toHaveBeenCalled();
    });
  });

  describe('check-receipts', () => {
    it('disables the token behind a DeviceNotRegistered receipt', async () => {
      push.getReceipts.mockResolvedValue({
        'r-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      });

      await processor.process(
        receiptsJob({ receiptIds: ['r-1'], tokenByReceiptId: { 'r-1': 'tok' } }),
      );

      expect(prisma.pushToken.updateMany).toHaveBeenCalledWith({
        where: { token: 'tok', disabledAt: null },
        data: { disabledAt: expect.any(Date) },
      });
    });

    it('leaves the token in place on a non-token error receipt', async () => {
      push.getReceipts.mockResolvedValue({
        'r-1': { status: 'error', message: 'MessageRateExceeded' },
      });

      await processor.process(
        receiptsJob({ receiptIds: ['r-1'], tokenByReceiptId: { 'r-1': 'tok' } }),
      );

      expect(prisma.pushToken.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing for an ok receipt', async () => {
      push.getReceipts.mockResolvedValue({ 'r-1': { status: 'ok' } });

      await processor.process(
        receiptsJob({ receiptIds: ['r-1'], tokenByReceiptId: { 'r-1': 'tok' } }),
      );

      expect(prisma.pushToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
