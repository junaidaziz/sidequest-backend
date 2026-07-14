import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Notification, NotificationPreference } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsQueueService } from './notifications-queue.service';
import {
  CHECK_RECEIPTS_JOB,
  CheckReceiptsJobData,
  NOTIFICATION_CATEGORY,
  NOTIFICATIONS_QUEUE,
  SEND_PUSH_JOB,
  SendPushJobData,
} from './notifications.constants';
import { DEFAULT_PREFERENCES } from './notifications.service';
import {
  DEVICE_NOT_REGISTERED,
  PUSH_PROVIDER_CLIENT,
  PushMessage,
  PushProviderClient,
} from './push-provider.interface';

/**
 * Consumes the `notifications` queue — the push-delivery side effect of
 * NotificationsService.notify(). Two job kinds, dispatched by name:
 *   - SEND_PUSH_JOB: respect the user's NotificationPreference, fan the
 *     notification out to their valid device tokens via the push provider,
 *     immediately disable any token the send rejects as DeviceNotRegistered, and
 *     schedule a delayed receipt poll for the accepted ones.
 *   - CHECK_RECEIPTS_JOB: poll delivery receipts and disable tokens the provider
 *     now reports dead — the delayed-follow-up idiom mirroring the verification
 *     queue's delayed job.
 *
 * Everything here is off the request path and best-effort: a delivery failure
 * never affects the already-persisted in-app notification.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationsQueueService,
    @Inject(PUSH_PROVIDER_CLIENT) private readonly push: PushProviderClient,
  ) {
    super();
  }

  async process(job: Job<SendPushJobData | CheckReceiptsJobData>): Promise<void> {
    if (job.name === SEND_PUSH_JOB) {
      await this.handleSendPush(job.data as SendPushJobData);
      return;
    }
    if (job.name === CHECK_RECEIPTS_JOB) {
      await this.handleCheckReceipts(job.data as CheckReceiptsJobData);
      return;
    }
    this.logger.warn(`Unknown notifications job '${job.name}' — ignoring`);
  }

  private async handleSendPush({ notificationId }: SendPushJobData): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      this.logger.warn(`Send-push skipped: notification ${notificationId} no longer exists`);
      return;
    }

    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId: notification.userId },
    });
    if (!this.pushAllowed(notification, preference)) {
      this.logger.log(
        `Send-push skipped for notification ${notificationId}: disabled by user preference`,
      );
      return;
    }

    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: notification.userId, disabledAt: null },
    });
    const deliverable = tokens.filter((t) => this.push.isValidToken(t.token));
    if (deliverable.length === 0) {
      this.logger.log(`Send-push skipped for notification ${notificationId}: no valid tokens`);
      return;
    }

    const messages: PushMessage[] = deliverable.map((t) => ({
      to: t.token,
      title: notification.title,
      body: notification.body,
      data: (notification.data as Record<string, unknown> | null) ?? undefined,
    }));

    const receiptIds: string[] = [];
    const tokenByReceiptId: Record<string, string> = {};

    for (const chunk of this.push.chunk(messages)) {
      let tickets;
      try {
        tickets = await this.push.send(chunk);
      } catch (error) {
        // Best-effort: a failed chunk is logged, not retried inline — the in-app
        // notification already exists, so we never block the user on push.
        this.logger.error(
          `Push send failed for notification ${notificationId}`,
          error instanceof Error ? error.stack : undefined,
        );
        continue;
      }

      for (let i = 0; i < tickets.length; i += 1) {
        const ticket = tickets[i];
        const token = chunk[i].to;
        if (ticket.status === 'ok' && ticket.id) {
          receiptIds.push(ticket.id);
          tokenByReceiptId[ticket.id] = token;
        } else if (ticket.status === 'error' && ticket.details?.error === DEVICE_NOT_REGISTERED) {
          await this.disableToken(token);
        }
      }
    }

    if (receiptIds.length > 0) {
      await this.queue.enqueueReceiptCheck(receiptIds, tokenByReceiptId);
    }
    this.logger.log(
      `Delivered notification ${notificationId} to ${deliverable.length} token(s); ` +
        `${receiptIds.length} receipt(s) pending`,
    );
  }

  private async handleCheckReceipts({
    receiptIds,
    tokenByReceiptId,
  }: CheckReceiptsJobData): Promise<void> {
    const receipts = await this.push.getReceipts(receiptIds);
    for (const [receiptId, receipt] of Object.entries(receipts)) {
      if (receipt.status === 'error' && receipt.details?.error === DEVICE_NOT_REGISTERED) {
        const token = tokenByReceiptId[receiptId];
        if (token) {
          await this.disableToken(token);
        }
      } else if (receipt.status === 'error') {
        // A non-token error (e.g. MessageRateExceeded) — log but keep the token.
        this.logger.warn(`Push receipt ${receiptId} errored: ${receipt.message ?? 'unknown'}`);
      }
    }
  }

  /**
   * Whether push is allowed for this notification given the user's preference.
   * Absent preference => all-enabled default (mirrors DEFAULT_PREFERENCES), so a
   * user who never opened Settings still receives push.
   */
  private pushAllowed(
    notification: Notification,
    preference: NotificationPreference | null,
  ): boolean {
    if (!preference) {
      return DEFAULT_PREFERENCES.pushEnabled;
    }
    if (!preference.pushEnabled) {
      return false;
    }
    const categoryFlag = NOTIFICATION_CATEGORY[notification.type];
    return preference[categoryFlag];
  }

  /**
   * Marks a token dead. Scoped by token value across all rows (a
   * DeviceNotRegistered token is dead globally, whoever it belongs to);
   * `disabledAt: null` in the filter keeps this idempotent — an already-disabled
   * token is untouched.
   */
  private async disableToken(token: string): Promise<void> {
    const result = await this.prisma.pushToken.updateMany({
      where: { token, disabledAt: null },
      data: { disabledAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.log(`Disabled ${result.count} dead push token row(s)`);
    }
  }
}
