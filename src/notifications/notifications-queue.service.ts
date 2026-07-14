import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import {
  CHECK_RECEIPTS_JOB,
  CheckReceiptsJobData,
  DEFAULT_RECEIPT_CHECK_DELAY_MINUTES,
  NOTIFICATIONS_QUEUE,
  RECEIPT_CHECK_DELAY_MINUTES_ENV,
  SEND_PUSH_JOB,
  SendPushJobData,
} from './notifications.constants';

const MS_PER_MINUTE = 60 * 1000;

/** Union of every payload shape this queue carries. */
type NotificationsJobData = SendPushJobData | CheckReceiptsJobData;

/**
 * Thin producer wrapper around the `notifications` queue — mirrors
 * VerificationQueueService. Keeps the delay math and BullMQ `add` options in one
 * testable place so NotificationsService/Processor only say "deliver this
 * notification" / "poll these receipts" without knowing queue mechanics.
 */
@Injectable()
export class NotificationsQueueService {
  private readonly logger = new Logger(NotificationsQueueService.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationsJobData>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Delay before the receipt-check job runs, in milliseconds. Falls back to the
   * 15-minute default when PUSH_RECEIPT_CHECK_DELAY_MINUTES is unset or not a
   * positive finite number (same NaN/zero guarding VerificationQueueService
   * applies — a bad value must not schedule a zero-delay receipt poll that races
   * Expo before receipts are ready).
   */
  private resolveReceiptDelayMs(): number {
    const raw = Number(this.config.get<string>(RECEIPT_CHECK_DELAY_MINUTES_ENV));
    const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECEIPT_CHECK_DELAY_MINUTES;
    return minutes * MS_PER_MINUTE;
  }

  /**
   * Enqueues immediate push delivery for a freshly-created notification. Uses
   * the notification id in the job id so a retried notify() can never enqueue
   * two sends for the same row.
   */
  async enqueuePushDelivery(notificationId: string): Promise<void> {
    await this.queue.add(
      SEND_PUSH_JOB,
      { notificationId },
      {
        // '-' not ':' — BullMQ's Job.validateOptions rejects a custom id
        // containing ':' (a real e2e failure caught this in the verification
        // queue); keep the same safe separator here.
        jobId: `${SEND_PUSH_JOB}-${notificationId}`,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.log(`Enqueued push delivery for notification ${notificationId}`);
  }

  /**
   * Schedules the delayed receipt poll for a batch of just-sent messages. The
   * job id is random (many sends can target overlapping tokens, so there is no
   * natural dedupe key) and, like every id here, uses '-' not ':'.
   */
  async enqueueReceiptCheck(
    receiptIds: string[],
    tokenByReceiptId: Record<string, string>,
  ): Promise<void> {
    if (receiptIds.length === 0) {
      return;
    }
    const delay = this.resolveReceiptDelayMs();
    await this.queue.add(
      CHECK_RECEIPTS_JOB,
      { receiptIds, tokenByReceiptId },
      {
        delay,
        jobId: `${CHECK_RECEIPTS_JOB}-${randomUUID()}`,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.log(`Scheduled receipt check for ${receiptIds.length} ticket(s) in ${delay}ms`);
  }
}
