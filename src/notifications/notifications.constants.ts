import { NotificationType } from '@prisma/client';

/**
 * The second BullMQ queue in the app (alongside `verification`). Owns
 * best-effort push delivery: the producer (NotificationsQueueService) enqueues
 * a send job when an in-app Notification is created, and the consumer
 * (NotificationsProcessor) delivers it via the push provider and schedules a
 * delayed receipt-check job. Queue/job-name constants live here so the producer
 * and consumer can never drift on a hard-coded string (same convention as
 * verification.constants.ts).
 */
export const NOTIFICATIONS_QUEUE = 'notifications';

/** Job that delivers one already-persisted Notification to the user's devices. */
export const SEND_PUSH_JOB = 'send-push';

/** Delayed job that polls delivery receipts and disables dead tokens. */
export const CHECK_RECEIPTS_JOB = 'check-receipts';

/**
 * Env var (minutes) controlling how long after a send the receipt-check job
 * runs. Expo advises waiting ~15 min before fetching receipts. Optional —
 * defaults to {@link DEFAULT_RECEIPT_CHECK_DELAY_MINUTES}.
 */
export const RECEIPT_CHECK_DELAY_MINUTES_ENV = 'PUSH_RECEIPT_CHECK_DELAY_MINUTES';

/** Fallback delay when the env var is unset or not a positive finite number. */
export const DEFAULT_RECEIPT_CHECK_DELAY_MINUTES = 15;

/** Payload for a {@link SEND_PUSH_JOB} — just the notification to deliver. */
export interface SendPushJobData {
  notificationId: string;
}

/**
 * Payload for a {@link CHECK_RECEIPTS_JOB}. Carries the receipt ids to poll and
 * a receiptId -> pushToken map so a `DeviceNotRegistered` receipt can be traced
 * back to the exact token to disable.
 */
export interface CheckReceiptsJobData {
  receiptIds: string[];
  tokenByReceiptId: Record<string, string>;
}

/**
 * Maps a notification type to the NotificationPreference category flag that
 * gates its push delivery. The processor loads the user's preference and skips
 * the push when either `pushEnabled` or the mapped category flag is false.
 */
export const NOTIFICATION_CATEGORY: Readonly<
  Record<NotificationType, 'taskEventsEnabled' | 'referralEventsEnabled' | 'accountEventsEnabled'>
> = {
  [NotificationType.task_assigned]: 'taskEventsEnabled',
  [NotificationType.task_accepted]: 'taskEventsEnabled',
  [NotificationType.task_declined]: 'taskEventsEnabled',
  [NotificationType.task_submitted]: 'taskEventsEnabled',
  [NotificationType.task_approved]: 'taskEventsEnabled',
  [NotificationType.task_rejected]: 'taskEventsEnabled',
  [NotificationType.referral_registered]: 'referralEventsEnabled',
  [NotificationType.referral_reward_earned]: 'referralEventsEnabled',
  [NotificationType.account_event]: 'accountEventsEnabled',
};
