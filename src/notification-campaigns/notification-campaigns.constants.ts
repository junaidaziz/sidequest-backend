/**
 * The third BullMQ queue in the app (alongside `verification` and
 * `notifications`). It is owned entirely by NotificationCampaignsModule — the
 * producer (NotificationCampaignsQueueService) enqueues a fan-out job when an
 * admin sends/schedules a campaign, and the consumer
 * (NotificationCampaignsProcessor) resolves the campaign's `targetFilter` to a
 * recipient set and delivers each one via NotificationsService.notify().
 *
 * A dedicated queue (rather than a job bolted onto the `notifications` queue)
 * keeps this module self-contained and avoids modifying NotificationsProcessor
 * for a concern that isn't its own. Queue/job-name constants live here so the
 * producer and consumer can never drift on a hard-coded string (same convention
 * as verification.constants.ts / notifications.constants.ts).
 */
export const NOTIFICATION_CAMPAIGNS_QUEUE = 'campaigns';

/** Job that fans a single campaign out to its resolved recipient set. */
export const SEND_CAMPAIGN_JOB = 'send-campaign';

/** Payload for a {@link SEND_CAMPAIGN_JOB} — just the campaign to fan out. */
export interface SendCampaignJobData {
  campaignId: string;
}
