import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  CampaignRecipientStatus,
  NotificationCampaignStatus,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NOTIFICATION_CAMPAIGNS_QUEUE,
  SendCampaignJobData,
} from './notification-campaigns.constants';
import { CampaignTargetFilter, buildTargetWhere } from './types/campaign-targeting';

/** Reason stamped on recipients skipped for opting out of marketing. */
const SKIP_MARKETING_OPT_OUT = 'Recipient opted out of marketing notifications';
/** Reason stamped on recipients skipped because the campaign was cancelled mid-send. */
const SKIP_CAMPAIGN_CANCELLED = 'Campaign cancelled during send';

interface LockedCampaignRow {
  id: string;
  status: NotificationCampaignStatus;
  deletedAt: Date | null;
}

/**
 * Consumes the `campaigns` queue — the campaign fan-out worker. One job per
 * campaign:
 *   1. Re-lock the campaign (`SELECT ... FOR UPDATE`) and transition it to
 *      `Sending`, aborting if it was cancelled/deleted or is already terminal
 *      (so a duplicate/retried job is a safe no-op).
 *   2. Resolve `targetFilter` to concrete live, non-suspended `User` ids.
 *   3. Materialize `NotificationCampaignRecipient` rows (`createMany` +
 *      `skipDuplicates`, with the `@@unique([campaignId, userId])` constraint as
 *      the safety net).
 *   4. For each still-`Pending` recipient: skip (mark `Skipped`) if the user has
 *      opted out of marketing; otherwise deliver via NotificationsService.notify()
 *      and mark `Sent` with the created notification id. A per-recipient failure is
 *      isolated (marked `Failed`) and never aborts the rest of the fan-out.
 *   5. Update the campaign's counters and set it `Sent`/`completedAt` (or leave it
 *      `Cancelled` if a cancel landed mid-send).
 *
 * Processing every recipient synchronously within one job is an accepted v1
 * simplification for this app's scale — no multi-job chunking/batching.
 */
@Processor(NOTIFICATION_CAMPAIGNS_QUEUE)
export class NotificationCampaignsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationCampaignsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<SendCampaignJobData>): Promise<void> {
    const { campaignId } = job.data;

    const campaign = await this.startSending(campaignId);
    if (!campaign) {
      return;
    }

    try {
      await this.fanOut(campaignId, campaign);
    } catch (error) {
      // Idempotent retries: the campaign is left `Sending`, so a retry re-enters
      // and resumes with the recipients still Pending. Only on the final attempt
      // do we mark it `Failed` (terminal, no further retry), so operators can see
      // a fan-out that never completed.
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) {
        await this.prisma.notificationCampaign
          .update({
            where: { id: campaignId },
            data: { status: NotificationCampaignStatus.Failed, completedAt: new Date() },
          })
          .catch(() => undefined);
      }
      this.logger.error(
        `Campaign ${campaignId} fan-out failed (attempt ${job.attemptsMade + 1})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * Transitions the campaign into `Sending` under a row lock. Returns the
   * campaign's targetFilter to fan out, or null if the job should no-op (deleted,
   * cancelled before it ran, or already terminal from a duplicate job).
   */
  private async startSending(
    campaignId: string,
  ): Promise<{ targetFilter: CampaignTargetFilter | null } | null> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<LockedCampaignRow[]>`
        SELECT id, status, "deletedAt"
        FROM "NotificationCampaign"
        WHERE id = ${campaignId}
        FOR UPDATE`;

      if (!row || row.deletedAt) {
        this.logger.warn(`Fan-out skipped: campaign ${campaignId} missing or deleted`);
        return null;
      }
      if (row.status === NotificationCampaignStatus.Cancelled) {
        this.logger.log(`Fan-out skipped: campaign ${campaignId} was cancelled before it ran`);
        return null;
      }
      if (
        row.status !== NotificationCampaignStatus.Scheduled &&
        row.status !== NotificationCampaignStatus.Sending
      ) {
        // Already Sent/Failed/Draft — a stale or duplicate job. Safe no-op.
        this.logger.warn(`Fan-out skipped: campaign ${campaignId} is ${row.status}`);
        return null;
      }

      const updated = await tx.notificationCampaign.update({
        where: { id: campaignId },
        data: { status: NotificationCampaignStatus.Sending, startedAt: new Date() },
        select: { targetFilter: true },
      });
      return { targetFilter: updated.targetFilter as CampaignTargetFilter | null };
    });
  }

  private async fanOut(
    campaignId: string,
    campaign: { targetFilter: CampaignTargetFilter | null },
  ): Promise<void> {
    const detail = await this.prisma.notificationCampaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { headline: true, body: true, data: true },
    });

    // 1. Resolve the audience and materialize recipient rows.
    const users = await this.prisma.user.findMany({
      where: buildTargetWhere(campaign.targetFilter),
      select: { id: true },
    });
    if (users.length > 0) {
      await this.prisma.notificationCampaignRecipient.createMany({
        data: users.map((u) => ({ campaignId, userId: u.id })),
        skipDuplicates: true,
      });
    }

    // 2. Deliver to every still-Pending recipient.
    const recipients = await this.prisma.notificationCampaignRecipient.findMany({
      where: { campaignId, status: CampaignRecipientStatus.Pending },
      select: { id: true, userId: true },
    });

    const payload = (detail.data as Record<string, unknown> | null) ?? undefined;
    let sent = 0;
    let failed = 0;
    let cancelled = false;

    for (const recipient of recipients) {
      if (await this.isCancelled(campaignId)) {
        // Best-effort mid-flight stop: mark everything not yet processed Skipped.
        await this.prisma.notificationCampaignRecipient.updateMany({
          where: { campaignId, status: CampaignRecipientStatus.Pending },
          data: { status: CampaignRecipientStatus.Skipped, failureReason: SKIP_CAMPAIGN_CANCELLED },
        });
        cancelled = true;
        break;
      }

      const preference = await this.prisma.notificationPreference.findUnique({
        where: { userId: recipient.userId },
      });
      // Absence of a row = enabled (universal convention here); only an explicit
      // `false` opts out. Do NOT invert this default.
      if (preference && preference.marketingEnabled === false) {
        await this.prisma.notificationCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: CampaignRecipientStatus.Skipped, failureReason: SKIP_MARKETING_OPT_OUT },
        });
        continue;
      }

      try {
        const notification = await this.notifications.notify({
          userId: recipient.userId,
          type: NotificationType.campaign_broadcast,
          title: detail.headline,
          body: detail.body,
          data: payload,
        });
        await this.prisma.notificationCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: CampaignRecipientStatus.Sent,
            notificationId: notification.id,
            sentAt: new Date(),
          },
        });
        sent += 1;
      } catch (error) {
        await this.prisma.notificationCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: CampaignRecipientStatus.Failed,
            failureReason: error instanceof Error ? error.message : 'Unknown delivery error',
          },
        });
        failed += 1;
      }
    }

    // 3. Finalize counters + terminal status (from the recipient rows, the source
    // of truth). A campaign cancelled mid-send stays Cancelled, not Sent.
    const total = await this.prisma.notificationCampaignRecipient.count({ where: { campaignId } });
    const failedTotal = await this.prisma.notificationCampaignRecipient.count({
      where: { campaignId, status: CampaignRecipientStatus.Failed },
    });
    const sentTotal = await this.prisma.notificationCampaignRecipient.count({
      where: { campaignId, status: CampaignRecipientStatus.Sent },
    });

    await this.prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: {
        totalRecipients: total,
        sentCount: sentTotal,
        failedCount: failedTotal,
        status: cancelled ? NotificationCampaignStatus.Cancelled : NotificationCampaignStatus.Sent,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Campaign ${campaignId} fan-out done: ${sent} sent, ${failed} failed, ${total} recipients` +
        (cancelled ? ' (cancelled mid-send)' : ''),
    );
  }

  /** Cheap per-recipient cancellation probe (best-effort mid-flight stop). */
  private async isCancelled(campaignId: string): Promise<boolean> {
    const row = await this.prisma.notificationCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    return row?.status === NotificationCampaignStatus.Cancelled;
  }
}
