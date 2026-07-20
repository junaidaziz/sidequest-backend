import { Job } from 'bullmq';
import {
  CampaignRecipientStatus,
  NotificationCampaignStatus,
  NotificationType,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCampaignsProcessor } from './notification-campaigns.processor';
import { SendCampaignJobData } from './notification-campaigns.constants';

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';

interface TxMock {
  $queryRaw: jest.Mock;
  notificationCampaign: { update: jest.Mock };
}

function makeJob(overrides: Partial<Job<SendCampaignJobData>> = {}): Job<SendCampaignJobData> {
  return {
    data: { campaignId: CAMPAIGN_ID },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job<SendCampaignJobData>;
}

describe('NotificationCampaignsProcessor', () => {
  let processor: NotificationCampaignsProcessor;
  let tx: TxMock;
  let prisma: {
    $transaction: jest.Mock;
    notificationCampaign: {
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    user: { findMany: jest.Mock };
    notificationCampaignRecipient: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    notificationPreference: { findMany: jest.Mock };
  };
  let notifications: { notify: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { id: CAMPAIGN_ID, status: NotificationCampaignStatus.Sending, deletedAt: null },
        ]),
      notificationCampaign: { update: jest.fn().mockResolvedValue({ targetFilter: null }) },
    };
    prisma = {
      $transaction: jest.fn((fn: (client: TxMock) => unknown) => fn(tx)),
      notificationCampaign: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ status: NotificationCampaignStatus.Sending }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ headline: 'H', body: 'B', data: { screen: 'home' } }),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
      notificationCampaignRecipient: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', userId: 'u1' },
          { id: 'r2', userId: 'u2' },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
      notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { notify: jest.fn().mockResolvedValue({ id: 'notif-1' }) };

    processor = new NotificationCampaignsProcessor(
      prisma as never,
      notifications as unknown as NotificationsService,
    );
  });

  it('transitions to Sending, delivers to each enabled recipient, and finalizes to Sent', async () => {
    prisma.notificationCampaignRecipient.count
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(2); // sent

    await processor.process(makeJob());

    expect(tx.notificationCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationCampaignStatus.Sending }),
      }),
    );
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.campaign_broadcast, title: 'H', body: 'B' }),
    );
    // Recipient marked Sent with the created notification id.
    expect(prisma.notificationCampaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CampaignRecipientStatus.Sent,
          notificationId: 'notif-1',
        }),
      }),
    );
    // Final campaign status is Sent.
    expect(prisma.notificationCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationCampaignStatus.Sent }),
      }),
    );
  });

  it('skips a recipient who has opted out of marketing (marketingEnabled = false)', async () => {
    // The batched query only returns rows for recipients with an explicit
    // marketingEnabled: false row — u1 opted out, u2 has no row (enabled by
    // the absence-means-enabled convention) and so is never returned here.
    prisma.notificationPreference.findMany.mockResolvedValue([{ userId: 'u1' }]);

    await processor.process(makeJob());

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(prisma.notificationCampaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: CampaignRecipientStatus.Skipped }),
      }),
    );
  });

  it('treats an absent preference row as enabled (absence = enabled convention)', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([]);
    await processor.process(makeJob());
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('marks a recipient Failed when notify throws, without aborting the rest', async () => {
    notifications.notify
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({ id: 'notif-2' });

    await processor.process(makeJob());

    expect(prisma.notificationCampaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          status: CampaignRecipientStatus.Failed,
          failureReason: 'db blip',
        }),
      }),
    );
    // Second recipient still delivered.
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('stops mid-send and skips the remainder when cancelled in-flight', async () => {
    prisma.notificationCampaign.findUnique.mockResolvedValue({
      status: NotificationCampaignStatus.Cancelled,
    });

    await processor.process(makeJob());

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.notificationCampaignRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: CampaignRecipientStatus.Skipped }),
      }),
    );
    // Terminal status stays Cancelled, not Sent.
    expect(prisma.notificationCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationCampaignStatus.Cancelled }),
      }),
    );
  });

  it('no-ops when the campaign was cancelled before the job ran', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: CAMPAIGN_ID, status: NotificationCampaignStatus.Cancelled, deletedAt: null },
    ]);
    await processor.process(makeJob());
    expect(tx.notificationCampaign.update).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('no-ops when the campaign is missing or deleted', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await processor.process(makeJob());
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('no-ops on a stale/duplicate job where the campaign is already terminal', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: CAMPAIGN_ID, status: NotificationCampaignStatus.Sent, deletedAt: null },
    ]);
    await processor.process(makeJob());
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('creates no recipient rows when the audience resolves to zero users', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.notificationCampaignRecipient.findMany.mockResolvedValue([]);
    await processor.process(makeJob());
    expect(prisma.notificationCampaignRecipient.createMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('marks the campaign Failed on the final attempt when the fan-out throws', async () => {
    prisma.user.findMany.mockRejectedValue(new Error('postgres down'));
    const finalAttemptJob = makeJob({ attemptsMade: 2 });

    await expect(processor.process(finalAttemptJob)).rejects.toThrow('postgres down');
    expect(prisma.notificationCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationCampaignStatus.Failed }),
      }),
    );
  });

  it('rethrows without marking Failed on a non-final attempt (leaves it for retry)', async () => {
    prisma.user.findMany.mockRejectedValue(new Error('transient'));
    const earlyAttemptJob = makeJob({ attemptsMade: 0 });

    await expect(processor.process(earlyAttemptJob)).rejects.toThrow('transient');
    expect(prisma.notificationCampaign.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationCampaignStatus.Failed }),
      }),
    );
  });
});
