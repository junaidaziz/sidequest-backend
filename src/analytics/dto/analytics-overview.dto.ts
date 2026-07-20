import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditLogEntryDto } from '../../audit-log/dto/audit-log-response.dto';

/**
 * ============================================================================
 *  Phase 12 — Admin analytics dashboard response DTOs.
 * ============================================================================
 *
 * These shapes back the mockup's `#analytics` section (web/mockups-admin/
 * 03-dashboard.html), but ONLY the parts with real backing data in this
 * backend's schema. Following the established convention of earlier phases
 * (Phase 8 disabled filter chips, Phase 9 dropped approval queue, Phase 10
 * dropped severity scores, Phase 11 dropped click/conversion tracking), every
 * metric the mockup shows that CANNOT be truthfully computed is called out here
 * with a doc comment explaining why the field is absent — it is never faked.
 *
 * Fabricated mockup metrics deliberately NOT modelled anywhere below:
 *   - DAU / MAU / "stickiness" — no session/app-open event table exists. Real
 *     mobile-usage analytics live in Firebase Analytics on the mobile client,
 *     which this backend has zero access to. Approximating from "completed a
 *     mission" would measure a much narrower thing and mislead.
 *   - True D1/D7/D30 return-and-open retention cohorts — same reason. Only the
 *     narrower registration→first-completion "activation" proxy is real (below).
 *   - App-version adoption — no app-version column exists on User or PushToken.
 *   - Public/private profile split — no profile-visibility concept in the schema.
 *   - "Completion rate" (attempted vs completed) — no attempt/started event is
 *     tracked; a mission is only recorded once proof is submitted, so there is no
 *     denominator. Only raw completion COUNTS are real.
 *   - System-health metrics (API latency p95, 5xx rate) — no APM/request-metrics
 *     infrastructure exists. Live BullMQ queue depth (below) is the real,
 *     available substitute for "system health".
 *   - Non-campaign notification "delivered %" — Notification has readAt (so an
 *     open metric is derivable) but no persisted per-row delivery success/failure
 *     outside campaign-recipient rows, so only campaign-scoped delivery stats are
 *     real (see CampaignRollupDto).
 *   - PDF export / scheduled email digest — no PDF-gen or digest-scheduling
 *     infrastructure exists. Only the real CSV export is built.
 */

/** The resolved, inclusive window the date-scoped metrics were computed over. */
export class AnalyticsRangeDto {
  @ApiProperty({ type: String, format: 'date-time' })
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: Date;
}

/** One day's registration count within the requested range. */
export class DailyCountDto {
  @ApiProperty({ description: 'UTC calendar day, YYYY-MM-DD', example: '2026-07-19' })
  date!: string;

  @ApiProperty({ description: 'New live registrations that day' })
  count!: number;
}

/**
 * User counts + growth. `totalLive`/`guests`/`fullAccounts` are current-state
 * (they ignore the date range). The guest-vs-full split is real (`User.isGuest`).
 *
 * NOT included: any public/private profile split — no profile-visibility concept
 * exists in the schema (fabricated in the mockup).
 */
export class UserAnalyticsDto {
  @ApiProperty({ description: 'All non-soft-deleted users (deletedAt IS NULL)' })
  totalLive!: number;

  @ApiProperty({ description: 'Live users still on an anonymous guest session (isGuest = true)' })
  guests!: number;

  @ApiProperty({ description: 'Live users who have upgraded to a full account (isGuest = false)' })
  fullAccounts!: number;

  @ApiProperty({ description: 'New live registrations whose createdAt falls in the range' })
  newInRange!: number;

  @ApiProperty({
    description: 'New live registrations in the immediately-preceding equal-length window',
  })
  newInPreviousRange!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Percent change of newInRange vs newInPreviousRange; null when the previous window was 0 ' +
      '(a percent change off a zero base is undefined, not "+infinity")',
  })
  newChangePct!: number | null;

  @ApiProperty({
    type: [DailyCountDto],
    description: 'Daily-bucketed new registrations in the range',
  })
  dailyRegistrations!: DailyCountDto[];
}

/** Completion counts, verification-status breakdown, and XP awarded in range. */
export class CompletionStatusBreakdownDto {
  @ApiProperty()
  pending!: number;

  @ApiProperty()
  approved!: number;

  @ApiProperty()
  rejected!: number;
}

export class CompletionAnalyticsDto {
  @ApiProperty({ description: 'Completions whose completedAt falls in the range' })
  totalInRange!: number;

  @ApiProperty({ type: CompletionStatusBreakdownDto })
  byStatus!: CompletionStatusBreakdownDto;

  @ApiProperty({
    description:
      'Sum of Completion.xpAwarded in range. XP is awarded optimistically at submission ' +
      'regardless of verification status (reversed only on later Rejected), so this is ' +
      'gross XP granted in the window, not net-of-rejection.',
  })
  xpAwardedInRange!: number;

  @ApiProperty({ description: 'Completions in the immediately-preceding equal-length window' })
  totalInPreviousRange!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Percent change vs the previous window; null when the previous window was 0',
  })
  changePct!: number | null;

  // NOT included: a "completion rate" (attempted vs completed). No attempt/started
  // event is tracked anywhere — there is no denominator to divide by (fabricated
  // in the mockup).
}

/** Proof-review backlog snapshot (current-state; ignores the date range). */
export class ProofBacklogDto {
  @ApiProperty({ description: 'Completions still awaiting review (verificationStatus = Pending)' })
  pendingCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'completedAt of the oldest still-Pending completion; null when the backlog is empty',
  })
  oldestPendingAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Age in whole hours of the oldest still-Pending completion; null when empty',
  })
  oldestPendingAgeHours!: number | null;
}

/** Moderation snapshot (current-state; ignores the date range). */
export class ModerationSnapshotDto {
  @ApiProperty({ description: 'Reports still Open (not soft-deleted)' })
  openReports!: number;

  @ApiProperty({ description: 'Live users currently suspended (suspendedAt IS NOT NULL)' })
  suspendedUsers!: number;
}

/** One level bucket in the XP/level distribution. */
export class LevelBucketDto {
  @ApiProperty({ description: '1-based level from the exact flat curve floor(totalXp/100)+1' })
  level!: number;

  @ApiProperty({ description: 'Live users at this level' })
  userCount!: number;
}

/** One window of the activation proxy. */
export class ActivationWindowDto {
  @ApiProperty({ description: 'Days after registration the first completion had to land within' })
  windowDays!: number;

  @ApiProperty({ description: 'Cohort users whose first completion landed within windowDays' })
  activatedCount!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 1,
    description: 'activatedCount / cohortSize, in [0,1]; 0 when the cohort is empty',
  })
  rate!: number;
}

/**
 * Genuine, narrower activation proxy: of the users who REGISTERED in the range,
 * what share completed >=1 mission within N days of THEIR OWN registration date
 * (User.createdAt → earliest Completion.completedAt).
 *
 * This is honestly labelled "activation" and is NOT "D1/D7/D30 retention" in the
 * app-open sense: there is no session/app-open event table in this schema, so a
 * true return-and-open retention cohort cannot be computed here (that lives in
 * Firebase Analytics on the mobile client). The windows are cumulative
 * (within-1 ⊆ within-7 ⊆ within-30). Recently-registered cohorts have not had
 * time to mature into the longer windows — read the longer windows as a lower
 * bound for a young cohort.
 */
export class ActivationDto {
  @ApiProperty({ description: 'Live users who registered within the range (the denominator)' })
  cohortSize!: number;

  @ApiProperty({ type: [ActivationWindowDto] })
  windows!: ActivationWindowDto[];
}

/**
 * Registered device tokens by platform. Honestly a DEVICE count, not an "active
 * installs"/user count: a user may have 0, 1, or several enabled tokens, so this
 * counts PushToken rows with disabledAt IS NULL grouped by platform — it is not a
 * distinct-user count and must not be relabelled "active installs" (the mockup's
 * term, which would overstate reach).
 */
export class DeviceTokenBucketDto {
  @ApiProperty({ description: 'Device platform (ios | android)' })
  platform!: string;

  @ApiProperty({ description: 'Enabled push tokens on this platform (disabledAt IS NULL)' })
  count!: number;
}

/**
 * Aggregate delivery + open performance across the most recent Sent campaigns
 * (Phase 11's real data). Mirrors CampaignStatsDto: click/conversion metrics are
 * deliberately absent (no link-tracking or attribution infrastructure exists).
 */
export class CampaignRollupDto {
  @ApiProperty({ description: 'How many recent Sent campaigns this rollup aggregates over' })
  campaignsConsidered!: number;

  @ApiProperty()
  totalRecipients!: number;

  @ApiProperty({ description: 'Recipients successfully delivered to' })
  sent!: number;

  @ApiProperty({ description: 'Recipients whose delivery failed' })
  failed!: number;

  @ApiProperty({
    description: 'Recipients skipped (e.g. marketing opt-out) — no notification sent',
  })
  skipped!: number;

  @ApiProperty({
    description: 'Delivered notifications the recipient has since opened (readAt set)',
  })
  opened!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 1,
    description: 'opened / sent, in [0,1]; 0 when nothing has been sent yet',
  })
  openRate!: number;
}

/**
 * Live BullMQ job counts for one queue — the real, available substitute for the
 * mockup's fabricated "system health" (API latency / error-rate) panel. Fetched
 * fresh on every request (NOT part of the cached KPI block), and best-effort:
 * `available: false` with zeroed counts if the queue can't be read (Redis blip),
 * never a failed request.
 */
export class QueueDepthDto {
  @ApiProperty({ description: 'Queue name (verification | notifications | campaigns)' })
  queue!: string;

  @ApiProperty()
  waiting!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  delayed!: number;

  @ApiProperty()
  completed!: number;

  @ApiProperty()
  failed!: number;

  @ApiProperty({ description: 'False when the queue counts could not be read (best-effort)' })
  available!: boolean;
}

/**
 * The full admin analytics overview. The date-scoped KPI block (users →
 * campaigns) is Redis-cached with a short TTL keyed by the resolved range;
 * `queueDepth` and `recentActivity` are always fetched live so the dashboard's
 * operational panels are never stale.
 */
export class AnalyticsOverviewDto {
  @ApiProperty({ type: AnalyticsRangeDto })
  range!: AnalyticsRangeDto;

  @ApiProperty({ type: UserAnalyticsDto })
  users!: UserAnalyticsDto;

  @ApiProperty({ type: CompletionAnalyticsDto })
  completions!: CompletionAnalyticsDto;

  @ApiProperty({ type: ProofBacklogDto })
  proofBacklog!: ProofBacklogDto;

  @ApiProperty({ type: ModerationSnapshotDto })
  moderation!: ModerationSnapshotDto;

  @ApiProperty({ type: [LevelBucketDto], description: 'Users bucketed by level (ascending)' })
  levelDistribution!: LevelBucketDto[];

  @ApiProperty({ type: ActivationDto })
  activation!: ActivationDto;

  @ApiProperty({ type: [DeviceTokenBucketDto] })
  deviceTokens!: DeviceTokenBucketDto[];

  @ApiProperty({ type: CampaignRollupDto })
  campaigns!: CampaignRollupDto;

  @ApiProperty({ type: [QueueDepthDto], description: 'Live queue depth (not cached)' })
  queueDepth!: QueueDepthDto[];

  @ApiProperty({
    type: [AuditLogEntryDto],
    description: 'Most recent admin actions, reusing AuditLogService.list() (not cached)',
  })
  recentActivity!: AuditLogEntryDto[];
}
