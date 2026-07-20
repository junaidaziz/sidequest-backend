import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CampaignRecipientStatus, NotificationCampaignStatus } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationCampaignsQueueService } from './notification-campaigns-queue.service';
import { NotificationCampaignsService } from './notification-campaigns.service';
import { CampaignActionContext } from './types/campaign-targeting';

const CTX: CampaignActionContext = {
  actorAdminUserId: 'admin-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};
const ID = '11111111-1111-1111-1111-111111111111';

interface TxMock {
  $queryRaw: jest.Mock;
  notificationCampaign: { update: jest.Mock };
}

function baseCampaign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    title: 'Launch',
    headline: 'We launched',
    body: 'Check it out',
    data: null,
    targetFilter: null,
    status: NotificationCampaignStatus.Draft,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    totalRecipients: 0,
    sentCount: 0,
    failedCount: 0,
    createdByAdminId: 'admin-1',
    updatedByAdminId: 'admin-1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('NotificationCampaignsService', () => {
  let service: NotificationCampaignsService;
  let tx: TxMock;
  let prisma: {
    $transaction: jest.Mock;
    notificationCampaign: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    notificationCampaignRecipient: { groupBy: jest.Mock; count: jest.Mock };
    user: { count: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let queue: { enqueueSend: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      notificationCampaign: { update: jest.fn().mockResolvedValue(baseCampaign()) },
    };
    prisma = {
      // Support both array-form ($transaction([...])) and callback-form.
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (client: TxMock) => unknown)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
      notificationCampaign: {
        findMany: jest.fn().mockResolvedValue([baseCampaign()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(baseCampaign()),
        create: jest.fn().mockResolvedValue(baseCampaign()),
        update: jest.fn().mockResolvedValue(baseCampaign()),
      },
      notificationCampaignRecipient: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { count: jest.fn().mockResolvedValue(42) },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    queue = { enqueueSend: jest.fn().mockResolvedValue(undefined) };

    service = new NotificationCampaignsService(
      prisma as never,
      audit as unknown as AuditLogService,
      queue as unknown as NotificationCampaignsQueueService,
    );
  });

  describe('list', () => {
    it('paginates and excludes soft-deleted campaigns', async () => {
      const result = await service.list({ page: 2, pageSize: 10 });
      expect(prisma.notificationCampaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null }, skip: 10, take: 10 }),
      );
      expect(result).toMatchObject({ total: 1, page: 2, pageSize: 10 });
    });

    it('applies the status filter when supplied', async () => {
      await service.list({ status: NotificationCampaignStatus.Sent });
      expect(prisma.notificationCampaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, status: NotificationCampaignStatus.Sent },
        }),
      );
    });
  });

  describe('getCampaign', () => {
    it('returns detail with derived stats', async () => {
      prisma.notificationCampaignRecipient.groupBy.mockResolvedValue([
        { status: CampaignRecipientStatus.Sent, _count: { _all: 8 } },
        { status: CampaignRecipientStatus.Failed, _count: { _all: 2 } },
        { status: CampaignRecipientStatus.Skipped, _count: { _all: 1 } },
      ]);
      prisma.notificationCampaignRecipient.count.mockResolvedValue(4); // opens

      const detail = await service.getCampaign(ID);
      expect(detail.stats).toMatchObject({
        totalRecipients: 11,
        sent: 8,
        failed: 2,
        skipped: 1,
        openCount: 4,
        openRate: 0.5,
      });
    });

    it('throws 404 when the campaign is missing', async () => {
      prisma.notificationCampaign.findFirst.mockResolvedValue(null);
      await expect(service.getCampaign(ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('previewAudience', () => {
    it('resolves the saved filter to a user count without creating rows', async () => {
      prisma.notificationCampaign.findFirst.mockResolvedValue(
        baseCampaign({ targetFilter: { isGuest: false } }),
      );
      const result = await service.previewAudience(ID);
      expect(result).toEqual({ count: 42 });
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ deletedAt: null, suspendedAt: null, isGuest: false }),
      });
    });
  });

  describe('create', () => {
    it('creates a Draft and audits campaigns.create', async () => {
      await service.create(
        { title: 'T', headline: 'H', body: 'B', scheduledAt: '2026-08-01T00:00:00Z' },
        CTX,
      );
      expect(prisma.notificationCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotificationCampaignStatus.Draft,
            createdByAdminId: 'admin-1',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaigns.create', targetId: ID }),
      );
    });

    it('persists the data + targetFilter payloads when supplied', async () => {
      await service.create(
        {
          title: 'T',
          headline: 'H',
          body: 'B',
          data: { screen: 'promo' },
          targetFilter: { isGuest: true },
        },
        CTX,
      );
      const call = prisma.notificationCampaign.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).toMatchObject({
        data: { screen: 'promo' },
        targetFilter: { isGuest: true },
        scheduledAt: null,
      });
    });
  });

  describe('update', () => {
    it('edits a Draft', async () => {
      await service.update(ID, { title: 'New title' }, CTX);
      expect(prisma.notificationCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ID } }),
      );
    });

    it('applies every editable field, including clearing scheduledAt', async () => {
      await service.update(
        ID,
        {
          title: 'T2',
          headline: 'H2',
          body: 'B2',
          data: { screen: 'promo' },
          targetFilter: { minTotalXp: 10 },
          scheduledAt: '2026-09-01T00:00:00Z',
        },
        CTX,
      );
      const call = prisma.notificationCampaign.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).toMatchObject({
        title: 'T2',
        headline: 'H2',
        body: 'B2',
        data: { screen: 'promo' },
        targetFilter: { minTotalXp: 10 },
        scheduledAt: new Date('2026-09-01T00:00:00Z'),
      });
    });

    it('sets scheduledAt to null when passed an empty value', async () => {
      await service.update(ID, { scheduledAt: '' }, CTX);
      const call = prisma.notificationCampaign.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data.scheduledAt).toBeNull();
    });

    it('throws 409 when the campaign is no longer a Draft', async () => {
      prisma.notificationCampaign.findFirst.mockResolvedValue(
        baseCampaign({ status: NotificationCampaignStatus.Sending }),
      );
      await expect(service.update(ID, { title: 'X' }, CTX)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.notificationCampaign.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes a Draft under a row lock', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: ID, status: NotificationCampaignStatus.Draft, scheduledAt: null, deletedAt: null },
      ]);
      await service.remove(ID, CTX);
      expect(tx.notificationCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaigns.create' }),
      );
    });

    it('throws 404 when the locked row is missing or already deleted', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.remove(ID, CTX)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 409 when the campaign is no longer a Draft', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: ID, status: NotificationCampaignStatus.Sent, scheduledAt: null, deletedAt: null },
      ]);
      await expect(service.remove(ID, CTX)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('send', () => {
    it('transitions a Draft to Sending and enqueues an immediate job', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: ID, status: NotificationCampaignStatus.Draft, scheduledAt: null, deletedAt: null },
      ]);
      await service.send(ID, CTX);
      expect(tx.notificationCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationCampaignStatus.Sending }),
        }),
      );
      expect(queue.enqueueSend).toHaveBeenCalledWith(ID, 0);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaigns.send' }),
      );
    });

    it('schedules with a future delay when scheduledAt is in the future', async () => {
      const future = new Date(Date.now() + 60_000);
      tx.$queryRaw.mockResolvedValue([
        {
          id: ID,
          status: NotificationCampaignStatus.Draft,
          scheduledAt: future,
          deletedAt: null,
        },
      ]);
      await service.send(ID, CTX);
      expect(tx.notificationCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationCampaignStatus.Scheduled }),
        }),
      );
      const [, delay] = queue.enqueueSend.mock.calls[0] as [string, number];
      expect(delay).toBeGreaterThan(0);
    });

    it('throws 409 when the campaign is not Draft or Scheduled', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: ID, status: NotificationCampaignStatus.Sending, scheduledAt: null, deletedAt: null },
      ]);
      await expect(service.send(ID, CTX)).rejects.toBeInstanceOf(ConflictException);
      expect(queue.enqueueSend).not.toHaveBeenCalled();
    });

    it('compensates the status change and throws 503 when the enqueue fails', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: ID, status: NotificationCampaignStatus.Draft, scheduledAt: null, deletedAt: null },
      ]);
      queue.enqueueSend.mockRejectedValue(new Error('redis down'));
      await expect(service.send(ID, CTX)).rejects.toBeInstanceOf(ServiceUnavailableException);
      // Reverted back to the previous (Draft) status.
      expect(prisma.notificationCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: NotificationCampaignStatus.Draft },
        }),
      );
    });
  });

  describe('cancel', () => {
    it('cancels a Sending campaign', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: ID, status: NotificationCampaignStatus.Sending, scheduledAt: null, deletedAt: null },
      ]);
      await service.cancel(ID, CTX);
      expect(tx.notificationCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationCampaignStatus.Cancelled }),
        }),
      );
    });

    it('throws 409 when the campaign is not Scheduled or Sending', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: ID, status: NotificationCampaignStatus.Draft, scheduledAt: null, deletedAt: null },
      ]);
      await expect(service.cancel(ID, CTX)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
