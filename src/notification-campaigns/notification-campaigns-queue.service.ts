import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  NOTIFICATION_CAMPAIGNS_QUEUE,
  SEND_CAMPAIGN_JOB,
  SendCampaignJobData,
} from './notification-campaigns.constants';

/**
 * Thin producer wrapper around the `campaigns` queue — mirrors
 * VerificationQueueService / NotificationsQueueService. Keeps the BullMQ `add`
 * options in one testable place so the service only says "fan this campaign out,
 * now or after N ms" without knowing queue mechanics.
 *
 * A "scheduled" campaign is a plain BullMQ delayed job (`delay` in ms) — there is
 * no `@nestjs/schedule`/cron anywhere in this codebase; every scheduled behaviour
 * is a delayed job, matching the verification auto-approve and notification
 * receipt-check jobs.
 */
@Injectable()
export class NotificationCampaignsQueueService {
  private readonly logger = new Logger(NotificationCampaignsQueueService.name);

  constructor(
    @InjectQueue(NOTIFICATION_CAMPAIGNS_QUEUE) private readonly queue: Queue<SendCampaignJobData>,
  ) {}

  /**
   * Enqueues the fan-out job for a campaign, optionally delayed until its
   * scheduled time. The campaign id is baked into the job id (`send-campaign-<id>`)
   * — deterministic, so a double-send can never enqueue two fan-outs for the same
   * campaign — and uses '-' not ':' (BullMQ's Job.validateOptions rejects a custom
   * id containing ':', a real bug hit earlier in this project).
   */
  async enqueueSend(campaignId: string, delayMs = 0): Promise<void> {
    await this.queue.add(
      SEND_CAMPAIGN_JOB,
      { campaignId },
      {
        delay: delayMs,
        jobId: `${SEND_CAMPAIGN_JOB}-${campaignId}`,
        removeOnComplete: true,
        // A transient failure (e.g. a brief Postgres blip mid fan-out) must not
        // permanently strand the campaign — retry with backoff before giving up.
        // Retries are idempotent: the processor re-locks, skips already-created
        // recipient rows (@@unique + skipDuplicates), and only re-processes rows
        // still Pending. Bounded failed-job retention so Redis doesn't grow forever.
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnFail: { count: 1_000 },
      },
    );
    this.logger.log(`Enqueued fan-out for campaign ${campaignId} (delay ${delayMs}ms)`);
  }
}
