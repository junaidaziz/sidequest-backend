import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CampaignRecipientStatus,
  NotificationCampaignStatus,
  ReportStatus,
  VerificationStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditLogEntryDto } from '../audit-log/dto/audit-log-response.dto';
import { computeLevel } from '../home/level.util';
import { NOTIFICATION_CAMPAIGNS_QUEUE } from '../notification-campaigns/notification-campaigns.constants';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { VERIFICATION_QUEUE } from '../verification/verification.constants';
import {
  ACTIVATION_WINDOW_DAYS,
  ANALYTICS_CACHE_KEY_PREFIX,
  ANALYTICS_CACHE_TTL_ENV,
  CAMPAIGN_ROLLUP_LIMIT,
  DEFAULT_ANALYTICS_CACHE_TTL_SECONDS,
  DEFAULT_WINDOW_DAYS,
  RECENT_ACTIVITY_LIMIT,
} from './analytics.constants';
import { AnalyticsRangeQueryDto } from './dto/analytics-range-query.dto';
import {
  ActivationDto,
  AnalyticsOverviewDto,
  CampaignRollupDto,
  CompletionAnalyticsDto,
  DeviceTokenBucketDto,
  LevelBucketDto,
  ModerationSnapshotDto,
  ProofBacklogDto,
  QueueDepthDto,
  UserAnalyticsDto,
} from './dto/analytics-overview.dto';

/** The inclusive, resolved window the date-scoped metrics run over. */
export interface ResolvedRange {
  from: Date;
  to: Date;
}

/**
 * The date-range-keyed, Redis-cacheable slice of the overview. Excludes
 * `queueDepth` and `recentActivity`, which are always fetched live so the
 * operational panels never go stale.
 */
export interface AnalyticsKpiBlock {
  users: UserAnalyticsDto;
  completions: CompletionAnalyticsDto;
  proofBacklog: ProofBacklogDto;
  moderation: ModerationSnapshotDto;
  levelDistribution: LevelBucketDto[];
  activation: ActivationDto;
  deviceTokens: DeviceTokenBucketDto[];
  campaigns: CampaignRollupDto;
}

/**
 * Admin analytics dashboard (Phase 12). Read-only aggregate queries over the real
 * data model — every method computes a metric with genuine backing columns/tables;
 * fabricated mockup metrics (DAU/MAU, retention, app-version, system-health, etc.)
 * are documented as absent on the DTOs rather than approximated.
 *
 * Caching mirrors MissionPoolService exactly: a short, env-configurable Redis TTL
 * on the date-range KPI block, strictly best-effort — any Redis error falls
 * straight through to a live query. The cache key incorporates the resolved range
 * so different windows never collide. No nightly snapshot job is built: at this
 * app's data scale every aggregate below is cheap enough to compute on demand
 * behind the cache (the plan's "optional nightly job" was explicitly optional).
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly cacheTtlSeconds: number;

  /** Pairs each queue name with its injected instance for the live depth read. */
  private readonly queues: ReadonlyArray<{ name: string; queue: Queue }>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    @InjectQueue(VERIFICATION_QUEUE) verificationQueue: Queue,
    @InjectQueue(NOTIFICATIONS_QUEUE) notificationsQueue: Queue,
    @InjectQueue(NOTIFICATION_CAMPAIGNS_QUEUE) campaignsQueue: Queue,
  ) {
    // Read at DI time (same rationale as MissionPoolService): a top-level
    // process.env read would run before ConfigModule loads .env, and a bad value
    // should fail loudly at boot rather than silently disable cache writes.
    const raw = process.env[ANALYTICS_CACHE_TTL_ENV];
    const parsed = raw === undefined ? DEFAULT_ANALYTICS_CACHE_TTL_SECONDS : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${ANALYTICS_CACHE_TTL_ENV} must be a positive number, got "${raw}"`);
    }
    this.cacheTtlSeconds = parsed;

    this.queues = [
      { name: VERIFICATION_QUEUE, queue: verificationQueue },
      { name: NOTIFICATIONS_QUEUE, queue: notificationsQueue },
      { name: NOTIFICATION_CAMPAIGNS_QUEUE, queue: campaignsQueue },
    ];
  }

  // --- Public composition --------------------------------------------------

  /** Full dashboard: cached date-range KPI block + live queue depth + live activity feed. */
  async getOverview(query: AnalyticsRangeQueryDto): Promise<AnalyticsOverviewDto> {
    const range = this.resolveRange(query);
    const [kpis, queueDepth, recentActivity] = await Promise.all([
      this.getCachedKpis(range),
      this.getQueueDepth(),
      this.getRecentActivity(),
    ]);
    return { range, ...kpis, queueDepth, recentActivity };
  }

  /**
   * CSV serialization of the numeric KPIs (gated by analytics.export). Reuses the
   * SAME cached KPI block as the overview, plus a live queue-depth snapshot. The
   * recent-activity feed is intentionally omitted — it is a variable-width audit
   * feed, not a fixed KPI row, and already has its own paginated read.
   */
  async exportCsv(query: AnalyticsRangeQueryDto): Promise<string> {
    const range = this.resolveRange(query);
    const [kpis, queueDepth] = await Promise.all([this.getCachedKpis(range), this.getQueueDepth()]);
    return this.toCsv(range, kpis, queueDepth);
  }

  /**
   * Resolves optional ISO bounds to a concrete window. Defaults to the last
   * {@link DEFAULT_WINDOW_DAYS} days ending now. An inverted range (from > to) is a
   * 400 rather than a silently-empty result.
   */
  resolveRange(query: AnalyticsRangeQueryDto): ResolvedRange {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('`from` must not be after `to`');
    }
    return { from, to };
  }

  // --- Aggregate metrics (each independently unit-tested) -------------------

  /**
   * User counts + growth. Totals are current-state; `newInRange` and its daily
   * buckets honour the range, with a "vs previous period" diff over the
   * immediately-preceding equal-length window.
   */
  async getUserAnalytics(range: ResolvedRange): Promise<UserAnalyticsDto> {
    const { from, to } = range;
    const prev = this.previousWindow(range);
    const [totalLive, guests, newInRange, newInPreviousRange, dailyRows] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, isGuest: true } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: from, lte: to } } }),
      this.prisma.user.count({
        where: { deletedAt: null, createdAt: { gte: prev.from, lt: prev.to } },
      }),
      this.prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, count(*)::int AS count
        FROM users
        WHERE "deletedAt" IS NULL AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC`,
    ]);

    return {
      totalLive,
      guests,
      fullAccounts: totalLive - guests,
      newInRange,
      newInPreviousRange,
      newChangePct: this.changePct(newInRange, newInPreviousRange),
      dailyRegistrations: dailyRows.map((r) => ({ date: r.date, count: r.count })),
    };
  }

  /** Completion counts, verification-status breakdown, XP awarded, prev-period diff. */
  async getCompletionAnalytics(range: ResolvedRange): Promise<CompletionAnalyticsDto> {
    const { from, to } = range;
    const prev = this.previousWindow(range);
    const [grouped, xpAgg, totalInPreviousRange] = await Promise.all([
      this.prisma.completion.groupBy({
        by: ['verificationStatus'],
        where: { completedAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.completion.aggregate({
        where: { completedAt: { gte: from, lte: to } },
        _sum: { xpAwarded: true },
      }),
      this.prisma.completion.count({ where: { completedAt: { gte: prev.from, lt: prev.to } } }),
    ]);

    const countFor = (status: VerificationStatus): number =>
      grouped.find((g) => g.verificationStatus === status)?._count._all ?? 0;
    const totalInRange = grouped.reduce((acc, g) => acc + g._count._all, 0);

    return {
      totalInRange,
      byStatus: {
        pending: countFor(VerificationStatus.Pending),
        approved: countFor(VerificationStatus.Approved),
        rejected: countFor(VerificationStatus.Rejected),
      },
      xpAwardedInRange: xpAgg._sum.xpAwarded ?? 0,
      totalInPreviousRange,
      changePct: this.changePct(totalInRange, totalInPreviousRange),
    };
  }

  /** Proof-review backlog: pending count + age of the oldest still-Pending completion. */
  async getProofBacklog(): Promise<ProofBacklogDto> {
    const [pendingCount, oldest] = await Promise.all([
      this.prisma.completion.count({ where: { verificationStatus: VerificationStatus.Pending } }),
      this.prisma.completion.findFirst({
        where: { verificationStatus: VerificationStatus.Pending },
        orderBy: { completedAt: 'asc' },
        select: { completedAt: true },
      }),
    ]);

    const oldestPendingAt = oldest?.completedAt ?? null;
    const oldestPendingAgeHours = oldestPendingAt
      ? Math.floor((Date.now() - oldestPendingAt.getTime()) / (60 * 60 * 1000))
      : null;
    return { pendingCount, oldestPendingAt, oldestPendingAgeHours };
  }

  /** Open reports + currently-suspended live users. */
  async getModerationSnapshot(): Promise<ModerationSnapshotDto> {
    const [openReports, suspendedUsers] = await Promise.all([
      this.prisma.report.count({ where: { status: ReportStatus.Open, deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
    ]);
    return { openReports, suspendedUsers };
  }

  /**
   * Live users bucketed by level. Groups by distinct totalXp (far fewer rows than
   * users) and folds each bucket through the EXACT shared `computeLevel` curve —
   * so the distribution can never drift from the level shown everywhere else in the
   * app (no re-implemented floor(totalXp/100)+1 formula in SQL).
   */
  async getLevelDistribution(): Promise<LevelBucketDto[]> {
    const grouped = await this.prisma.user.groupBy({
      by: ['totalXp'],
      where: { deletedAt: null },
      _count: { _all: true },
    });

    const byLevel = new Map<number, number>();
    for (const g of grouped) {
      const level = computeLevel(g.totalXp).level;
      byLevel.set(level, (byLevel.get(level) ?? 0) + g._count._all);
    }
    return [...byLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, userCount]) => ({ level, userCount }));
  }

  /**
   * Activation proxy: of users who registered in the range, the share whose first
   * completion landed within N days of THEIR OWN registration. The JOIN (not a
   * LEFT JOIN) to each user's earliest completion naturally excludes never-completed
   * users from the numerator, while the cohort count is the denominator. Parametric
   * over {@link ACTIVATION_WINDOW_DAYS} — the SQL measures exactly
   * `first_completion <= createdAt + N days`, nothing else.
   */
  async getActivation(range: ResolvedRange): Promise<ActivationDto> {
    const { from, to } = range;
    const cohortSize = await this.prisma.user.count({
      where: { deletedAt: null, createdAt: { gte: from, lte: to } },
    });

    const windows = await Promise.all(
      ACTIVATION_WINDOW_DAYS.map(async (windowDays) => {
        const rows = await this.prisma.$queryRaw<{ activated: number }[]>`
          SELECT count(*)::int AS activated
          FROM users u
          JOIN (
            SELECT "userId", min("completedAt") AS first_completion
            FROM completions
            GROUP BY "userId"
          ) c ON c."userId" = u.id
          WHERE u."deletedAt" IS NULL
            AND u."createdAt" >= ${from} AND u."createdAt" <= ${to}
            AND c.first_completion <= u."createdAt" + make_interval(days => ${windowDays}::int)`;
        const activatedCount = rows[0]?.activated ?? 0;
        return {
          windowDays,
          activatedCount,
          rate: cohortSize > 0 ? activatedCount / cohortSize : 0,
        };
      }),
    );

    return { cohortSize, windows };
  }

  /** Enabled push tokens by platform (a DEVICE count, not a user/active-install count). */
  async getDeviceTokens(): Promise<DeviceTokenBucketDto[]> {
    const grouped = await this.prisma.pushToken.groupBy({
      by: ['platform'],
      where: { disabledAt: null },
      _count: { _all: true },
    });
    return grouped
      .map((g) => ({ platform: g.platform, count: g._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Aggregate delivery + open performance across the most recent Sent campaigns.
   * Aggregates the recipient rows (the source of truth, same basis as Phase 11's
   * per-campaign getStats) rather than the denormalized counters, so the rollup and
   * the per-campaign view can never disagree.
   */
  async getCampaignRollup(): Promise<CampaignRollupDto> {
    const recent = await this.prisma.notificationCampaign.findMany({
      where: { status: NotificationCampaignStatus.Sent, deletedAt: null },
      orderBy: { completedAt: 'desc' },
      take: CAMPAIGN_ROLLUP_LIMIT,
      select: { id: true },
    });
    const ids = recent.map((c) => c.id);
    if (ids.length === 0) {
      return {
        campaignsConsidered: 0,
        totalRecipients: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        opened: 0,
        openRate: 0,
      };
    }

    const [grouped, opened] = await Promise.all([
      this.prisma.notificationCampaignRecipient.groupBy({
        by: ['status'],
        where: { campaignId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.notificationCampaignRecipient.count({
        where: { campaignId: { in: ids }, notification: { readAt: { not: null } } },
      }),
    ]);

    const countFor = (status: CampaignRecipientStatus): number =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;
    const sent = countFor(CampaignRecipientStatus.Sent);
    const totalRecipients = grouped.reduce((acc, g) => acc + g._count._all, 0);

    return {
      campaignsConsidered: ids.length,
      totalRecipients,
      sent,
      failed: countFor(CampaignRecipientStatus.Failed),
      skipped: countFor(CampaignRecipientStatus.Skipped),
      opened,
      openRate: sent > 0 ? opened / sent : 0,
    };
  }

  /**
   * Live BullMQ job counts across the three real queues — the honest substitute for
   * the mockup's fabricated APM "system health" panel. Best-effort per queue: a
   * queue that can't be read (Redis blip) reports zeros with `available: false`
   * rather than failing the whole dashboard.
   */
  async getQueueDepth(): Promise<QueueDepthDto[]> {
    return Promise.all(
      this.queues.map(async ({ name, queue }) => {
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'completed',
            'failed',
          );
          return {
            queue: name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            available: true,
          };
        } catch (error) {
          this.logger.warn(`Queue depth read failed for "${name}": ${(error as Error).message}`);
          return {
            queue: name,
            waiting: 0,
            active: 0,
            delayed: 0,
            completed: 0,
            failed: 0,
            available: false,
          };
        }
      }),
    );
  }

  /** Recent admin activity — REUSES AuditLogService.list() sliced to the newest N rows. */
  async getRecentActivity(): Promise<AuditLogEntryDto[]> {
    const page = await this.auditLog.list({ page: 1, pageSize: RECENT_ACTIVITY_LIMIT });
    return page.items;
  }

  // --- Caching (best-effort, mirrors MissionPoolService) -------------------

  private async getCachedKpis(range: ResolvedRange): Promise<AnalyticsKpiBlock> {
    const key = this.cacheKey(range);
    const cached = await this.readCache(key);
    if (cached) return cached;

    const block = await this.computeKpis(range);
    void this.writeCache(key, block);
    return block;
  }

  private async computeKpis(range: ResolvedRange): Promise<AnalyticsKpiBlock> {
    const [
      users,
      completions,
      proofBacklog,
      moderation,
      levelDistribution,
      activation,
      deviceTokens,
      campaigns,
    ] = await Promise.all([
      this.getUserAnalytics(range),
      this.getCompletionAnalytics(range),
      this.getProofBacklog(),
      this.getModerationSnapshot(),
      this.getLevelDistribution(),
      this.getActivation(range),
      this.getDeviceTokens(),
      this.getCampaignRollup(),
    ]);
    return {
      users,
      completions,
      proofBacklog,
      moderation,
      levelDistribution,
      activation,
      deviceTokens,
      campaigns,
    };
  }

  private cacheKey(range: ResolvedRange): string {
    return `${ANALYTICS_CACHE_KEY_PREFIX}:${range.from.toISOString()}:${range.to.toISOString()}`;
  }

  private async readCache(key: string): Promise<AnalyticsKpiBlock | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return this.reviveKpis(JSON.parse(raw) as AnalyticsKpiBlock);
    } catch (error) {
      this.logger.warn(`Cache read failed, computing live: ${(error as Error).message}`);
      return null;
    }
  }

  private async writeCache(key: string, block: AnalyticsKpiBlock): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(block), 'EX', this.cacheTtlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed: ${(error as Error).message}`);
    }
  }

  /**
   * Revives the one Date field that survives the JSON round-trip as a string
   * (proofBacklog.oldestPendingAt); every other cached field is already a
   * number/string/plain object.
   */
  private reviveKpis(cached: AnalyticsKpiBlock): AnalyticsKpiBlock {
    const oldest = cached.proofBacklog.oldestPendingAt;
    return {
      ...cached,
      proofBacklog: {
        ...cached.proofBacklog,
        oldestPendingAt: oldest ? new Date(oldest) : null,
      },
    };
  }

  // --- helpers -------------------------------------------------------------

  /** The immediately-preceding, equal-length window: [from - span, from). */
  private previousWindow(range: ResolvedRange): ResolvedRange {
    const span = range.to.getTime() - range.from.getTime();
    return { from: new Date(range.from.getTime() - span), to: range.from };
  }

  /**
   * Percent change of `current` vs `previous`, rounded to 1 dp. Returns null when
   * `previous` is 0 — a percent change off a zero base is undefined, and returning
   * a giant/Infinity number would misrender in the dashboard.
   */
  private changePct(current: number, previous: number): number | null {
    if (previous === 0) return null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  /** Flat, spreadsheet-friendly CSV of the numeric KPIs (metric,value rows). */
  private toCsv(
    range: ResolvedRange,
    kpis: AnalyticsKpiBlock,
    queueDepth: QueueDepthDto[],
  ): string {
    const rows: Array<[string, string | number]> = [
      ['range_from', range.from.toISOString()],
      ['range_to', range.to.toISOString()],
      ['users_total_live', kpis.users.totalLive],
      ['users_guests', kpis.users.guests],
      ['users_full_accounts', kpis.users.fullAccounts],
      ['users_new_in_range', kpis.users.newInRange],
      ['users_new_in_previous_range', kpis.users.newInPreviousRange],
      ['users_new_change_pct', kpis.users.newChangePct ?? ''],
      ['completions_total_in_range', kpis.completions.totalInRange],
      ['completions_pending', kpis.completions.byStatus.pending],
      ['completions_approved', kpis.completions.byStatus.approved],
      ['completions_rejected', kpis.completions.byStatus.rejected],
      ['completions_xp_awarded_in_range', kpis.completions.xpAwardedInRange],
      ['completions_total_in_previous_range', kpis.completions.totalInPreviousRange],
      ['completions_change_pct', kpis.completions.changePct ?? ''],
      ['proof_backlog_pending', kpis.proofBacklog.pendingCount],
      ['proof_backlog_oldest_pending_age_hours', kpis.proofBacklog.oldestPendingAgeHours ?? ''],
      ['moderation_open_reports', kpis.moderation.openReports],
      ['moderation_suspended_users', kpis.moderation.suspendedUsers],
      ['activation_cohort_size', kpis.activation.cohortSize],
      ['campaigns_considered', kpis.campaigns.campaignsConsidered],
      ['campaigns_total_recipients', kpis.campaigns.totalRecipients],
      ['campaigns_sent', kpis.campaigns.sent],
      ['campaigns_failed', kpis.campaigns.failed],
      ['campaigns_skipped', kpis.campaigns.skipped],
      ['campaigns_opened', kpis.campaigns.opened],
      ['campaigns_open_rate', kpis.campaigns.openRate],
    ];

    for (const w of kpis.activation.windows) {
      rows.push([`activation_within_${w.windowDays}d_count`, w.activatedCount]);
      rows.push([`activation_within_${w.windowDays}d_rate`, w.rate]);
    }
    for (const bucket of kpis.levelDistribution) {
      rows.push([`level_${bucket.level}_users`, bucket.userCount]);
    }
    for (const bucket of kpis.deviceTokens) {
      rows.push([`device_tokens_${bucket.platform}`, bucket.count]);
    }
    for (const q of queueDepth) {
      rows.push([`queue_${q.queue}_waiting`, q.waiting]);
      rows.push([`queue_${q.queue}_active`, q.active]);
      rows.push([`queue_${q.queue}_delayed`, q.delayed]);
      rows.push([`queue_${q.queue}_failed`, q.failed]);
    }

    // Both sides go through csvCell: a metric key can carry a DB-sourced,
    // non-enum-constrained fragment (e.g. a device `platform` string), so a comma
    // there must be quoted too or it would shift every column on that row.
    const header = 'metric,value';
    const body = rows
      .map(([metric, value]) => `${this.csvCell(metric)},${this.csvCell(value)}`)
      .join('\n');
    return `${header}\n${body}\n`;
  }

  /** Quotes a CSV cell only when it contains a comma, quote, or newline (RFC-4180). */
  private csvCell(value: string | number): string {
    const s = String(value);
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
}
