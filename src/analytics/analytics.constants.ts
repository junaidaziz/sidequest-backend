import { NOTIFICATION_CAMPAIGNS_QUEUE } from '../notification-campaigns/notification-campaigns.constants';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants';
import { VERIFICATION_QUEUE } from '../verification/verification.constants';

/**
 * Constants for the admin analytics dashboard (Phase 12).
 *
 * The three queue names are RE-EXPORTED from their owning modules' constants
 * files rather than re-declared here, so a rename in one place can never drift a
 * dashboard label away from the queue it actually reads (`Queue.getJobCounts()`
 * is keyed by the exact registered name). These are the only three BullMQ queues
 * in the app.
 */
export const ANALYTICS_QUEUE_NAMES: readonly string[] = [
  VERIFICATION_QUEUE,
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_CAMPAIGNS_QUEUE,
];

/**
 * Env var (seconds) for the Redis cache TTL on the date-range KPI block. Same
 * pattern/spirit as MISSION_POOL_CACHE_TTL_SECONDS: a short, best-effort cache
 * that only ever trades a few minutes of staleness for lower DB load — never a
 * correctness dependency (any Redis error falls through to a live query).
 */
export const ANALYTICS_CACHE_TTL_ENV = 'ANALYTICS_CACHE_TTL_SECONDS';

/** Fallback TTL when the env var is unset or not a positive finite number. */
export const DEFAULT_ANALYTICS_CACHE_TTL_SECONDS = 300;

/** Redis key prefix for a cached overview KPI block; the resolved from/to are appended. */
export const ANALYTICS_CACHE_KEY_PREFIX = 'analytics:overview';

/**
 * Default look-back window (days) applied when the caller supplies no `from`/`to`.
 * A recent, cheap-to-compute range so the un-parameterised dashboard load is fast.
 */
export const DEFAULT_WINDOW_DAYS = 7;

/**
 * How many of the most recent `Sent` campaigns the campaign-performance rollup
 * aggregates over. Bounded so the rollup stays a small, fixed-cost query rather
 * than scanning every campaign ever sent.
 */
export const CAMPAIGN_ROLLUP_LIMIT = 10;

/**
 * How many of the most recent audit-log entries the dashboard's "recent admin
 * activity" feed surfaces. This feed REUSES AuditLogService.list() (no parallel
 * activity table is built) sliced to this many rows.
 */
export const RECENT_ACTIVITY_LIMIT = 10;

/**
 * The activation proxy is measured at these day-offsets from each cohort user's
 * own registration date. Deliberately labelled "activation" (registered → first
 * completion) and NOT "D1/D7/D30 retention" — there is no session/app-open event
 * table anywhere in this schema to back a true return-and-open retention cohort
 * (that data lives in Firebase Analytics on the mobile client, which this backend
 * has no access to). See ActivationDto for the full honesty note.
 */
export const ACTIVATION_WINDOW_DAYS: readonly number[] = [1, 7, 30];
