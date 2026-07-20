import { BadRequestException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AnalyticsService, AnalyticsKpiBlock, ResolvedRange } from './analytics.service';

/**
 * Verifies each aggregate genuinely measures what its DTO claims — in particular
 * that the level distribution folds through the exact shared computeLevel curve,
 * and that the activation query measures days-between-registration-and-first-
 * completion (not some looser proxy) — plus the best-effort cache + queue-depth
 * behaviour and the "vs previous period" diff.
 */

type Mock = jest.Mock;

interface PrismaMock {
  user: { count: Mock; groupBy: Mock };
  completion: { groupBy: Mock; aggregate: Mock; count: Mock; findFirst: Mock };
  report: { count: Mock };
  pushToken: { groupBy: Mock };
  notificationCampaign: { findMany: Mock };
  notificationCampaignRecipient: { groupBy: Mock; count: Mock };
  $queryRaw: Mock;
}

const RANGE: ResolvedRange = {
  from: new Date('2026-07-01T00:00:00.000Z'),
  to: new Date('2026-07-08T00:00:00.000Z'),
};

function makeQueue(counts?: Record<string, number>): { getJobCounts: Mock } {
  return {
    getJobCounts: jest
      .fn()
      .mockResolvedValue(counts ?? { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 }),
  };
}

describe('AnalyticsService', () => {
  let prisma: PrismaMock;
  let redis: { get: Mock; set: Mock };
  let auditLog: { list: Mock };
  let verificationQueue: { getJobCounts: Mock };
  let notificationsQueue: { getJobCounts: Mock };
  let campaignsQueue: { getJobCounts: Mock };
  const ORIGINAL_ENV = process.env;

  function build(): AnalyticsService {
    return new AnalyticsService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      auditLog as unknown as AuditLogService,
      verificationQueue as never,
      notificationsQueue as never,
      campaignsQueue as never,
    );
  }

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ANALYTICS_CACHE_TTL_SECONDS;
    prisma = {
      user: { count: jest.fn(), groupBy: jest.fn() },
      completion: {
        groupBy: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      report: { count: jest.fn() },
      pushToken: { groupBy: jest.fn() },
      notificationCampaign: { findMany: jest.fn() },
      notificationCampaignRecipient: { groupBy: jest.fn(), count: jest.fn() },
      $queryRaw: jest.fn(),
    };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
    auditLog = { list: jest.fn() };
    verificationQueue = makeQueue({ waiting: 1, active: 2, delayed: 3, completed: 4, failed: 5 });
    notificationsQueue = makeQueue();
    campaignsQueue = makeQueue();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  describe('constructor TTL validation', () => {
    it('throws at construction on a non-numeric TTL', () => {
      process.env.ANALYTICS_CACHE_TTL_SECONDS = 'soon';
      expect(() => build()).toThrow(/ANALYTICS_CACHE_TTL_SECONDS/);
    });

    it('throws at construction on a zero/negative TTL', () => {
      process.env.ANALYTICS_CACHE_TTL_SECONDS = '0';
      expect(() => build()).toThrow(/ANALYTICS_CACHE_TTL_SECONDS/);
    });

    it('accepts a valid override', () => {
      process.env.ANALYTICS_CACHE_TTL_SECONDS = '120';
      expect(() => build()).not.toThrow();
    });
  });

  describe('resolveRange', () => {
    it('defaults to the last 7 days ending now when unset', () => {
      const before = Date.now();
      const { from, to } = build().resolveRange({});
      const spanDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
      expect(spanDays).toBeCloseTo(7, 5);
      expect(to.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('uses the supplied bounds', () => {
      const { from, to } = build().resolveRange({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T00:00:00.000Z',
      });
      expect(from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(to.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    });

    it('rejects an inverted range with a 400', () => {
      expect(() =>
        build().resolveRange({ from: '2026-02-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' }),
      ).toThrow(BadRequestException);
    });
  });

  describe('getUserAnalytics', () => {
    it('reports totals, the guest split, daily buckets, and a vs-previous diff', async () => {
      prisma.user.count
        .mockResolvedValueOnce(100) // totalLive
        .mockResolvedValueOnce(30) // guests
        .mockResolvedValueOnce(20) // newInRange
        .mockResolvedValueOnce(10); // newInPreviousRange
      prisma.$queryRaw.mockResolvedValue([
        { date: '2026-07-01', count: 8 },
        { date: '2026-07-02', count: 12 },
      ]);

      const result = await build().getUserAnalytics(RANGE);

      expect(result.totalLive).toBe(100);
      expect(result.guests).toBe(30);
      expect(result.fullAccounts).toBe(70);
      expect(result.newInRange).toBe(20);
      expect(result.newInPreviousRange).toBe(10);
      expect(result.newChangePct).toBe(100); // (20-10)/10 * 100
      expect(result.dailyRegistrations).toEqual([
        { date: '2026-07-01', count: 8 },
        { date: '2026-07-02', count: 12 },
      ]);
    });

    it('returns a null change pct when the previous window was empty', async () => {
      prisma.user.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(0);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await build().getUserAnalytics(RANGE);
      expect(result.newChangePct).toBeNull();
    });
  });

  describe('getCompletionAnalytics', () => {
    it('breaks completions down by verification status and sums XP', async () => {
      prisma.completion.groupBy.mockResolvedValue([
        { verificationStatus: 'Pending', _count: { _all: 4 } },
        { verificationStatus: 'Approved', _count: { _all: 10 } },
        { verificationStatus: 'Rejected', _count: { _all: 2 } },
      ]);
      prisma.completion.aggregate.mockResolvedValue({ _sum: { xpAwarded: 640 } });
      prisma.completion.count.mockResolvedValue(8); // previous window

      const result = await build().getCompletionAnalytics(RANGE);

      expect(result.totalInRange).toBe(16);
      expect(result.byStatus).toEqual({ pending: 4, approved: 10, rejected: 2 });
      expect(result.xpAwardedInRange).toBe(640);
      expect(result.totalInPreviousRange).toBe(8);
      expect(result.changePct).toBe(100);
    });

    it('treats a null XP sum as 0 and missing statuses as 0', async () => {
      prisma.completion.groupBy.mockResolvedValue([]);
      prisma.completion.aggregate.mockResolvedValue({ _sum: { xpAwarded: null } });
      prisma.completion.count.mockResolvedValue(0);

      const result = await build().getCompletionAnalytics(RANGE);
      expect(result.totalInRange).toBe(0);
      expect(result.xpAwardedInRange).toBe(0);
      expect(result.byStatus).toEqual({ pending: 0, approved: 0, rejected: 0 });
      expect(result.changePct).toBeNull();
    });
  });

  describe('getProofBacklog', () => {
    it('computes the oldest-pending age in whole hours', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      prisma.completion.count.mockResolvedValue(7);
      prisma.completion.findFirst.mockResolvedValue({ completedAt: twoHoursAgo });

      const result = await build().getProofBacklog();
      expect(result.pendingCount).toBe(7);
      expect(result.oldestPendingAt).toEqual(twoHoursAgo);
      expect(result.oldestPendingAgeHours).toBe(2);
    });

    it('returns nulls for an empty backlog', async () => {
      prisma.completion.count.mockResolvedValue(0);
      prisma.completion.findFirst.mockResolvedValue(null);

      const result = await build().getProofBacklog();
      expect(result.pendingCount).toBe(0);
      expect(result.oldestPendingAt).toBeNull();
      expect(result.oldestPendingAgeHours).toBeNull();
    });
  });

  describe('getModerationSnapshot', () => {
    it('counts open reports and suspended live users', async () => {
      prisma.report.count.mockResolvedValue(3);
      prisma.user.count.mockResolvedValue(9);

      const result = await build().getModerationSnapshot();
      expect(result).toEqual({ openReports: 3, suspendedUsers: 9 });
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { deletedAt: null, suspendedAt: { not: null } },
      });
    });
  });

  describe('getLevelDistribution', () => {
    it('buckets users through the exact computeLevel curve, merging same-level XP values', async () => {
      // 0 XP -> level 1, 50 XP -> level 1 (merge), 150 -> level 2, 250 -> level 3.
      prisma.user.groupBy.mockResolvedValue([
        { totalXp: 0, _count: { _all: 5 } },
        { totalXp: 50, _count: { _all: 3 } },
        { totalXp: 150, _count: { _all: 4 } },
        { totalXp: 250, _count: { _all: 1 } },
      ]);

      const result = await build().getLevelDistribution();
      expect(result).toEqual([
        { level: 1, userCount: 8 },
        { level: 2, userCount: 4 },
        { level: 3, userCount: 1 },
      ]);
    });
  });

  describe('getActivation', () => {
    it('measures first completion within N days of registration, per cohort window', async () => {
      prisma.user.count.mockResolvedValue(40); // cohort size
      // Windows fire in [1, 7, 30] order (synchronous $queryRaw calls before await).
      prisma.$queryRaw
        .mockResolvedValueOnce([{ activated: 4 }])
        .mockResolvedValueOnce([{ activated: 16 }])
        .mockResolvedValueOnce([{ activated: 30 }]);

      const result = await build().getActivation(RANGE);

      expect(result.cohortSize).toBe(40);
      expect(result.windows).toEqual([
        { windowDays: 1, activatedCount: 4, rate: 0.1 },
        { windowDays: 7, activatedCount: 16, rate: 0.4 },
        { windowDays: 30, activatedCount: 30, rate: 0.75 },
      ]);
      // The activation query must reference registration + first-completion, not a raw count.
      const sql = prisma.$queryRaw.mock.calls[0][0].join(' ');
      expect(sql).toContain('make_interval');
      expect(sql).toContain('first_completion');
    });

    it('reports a 0 rate for an empty cohort and never divides by zero', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([{ activated: 0 }]);

      const result = await build().getActivation(RANGE);
      expect(result.cohortSize).toBe(0);
      expect(result.windows.every((w) => w.rate === 0)).toBe(true);
    });
  });

  describe('getDeviceTokens', () => {
    it('counts enabled tokens per platform, most-common first', async () => {
      prisma.pushToken.groupBy.mockResolvedValue([
        { platform: 'ios', _count: { _all: 12 } },
        { platform: 'android', _count: { _all: 30 } },
      ]);

      const result = await build().getDeviceTokens();
      expect(result).toEqual([
        { platform: 'android', count: 30 },
        { platform: 'ios', count: 12 },
      ]);
      expect(prisma.pushToken.groupBy).toHaveBeenCalledWith({
        by: ['platform'],
        where: { disabledAt: null },
        _count: { _all: true },
      });
    });
  });

  describe('getCampaignRollup', () => {
    it('returns zeros when there are no sent campaigns', async () => {
      prisma.notificationCampaign.findMany.mockResolvedValue([]);
      const result = await build().getCampaignRollup();
      expect(result).toEqual({
        campaignsConsidered: 0,
        totalRecipients: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        opened: 0,
        openRate: 0,
      });
      expect(prisma.notificationCampaignRecipient.groupBy).not.toHaveBeenCalled();
    });

    it('aggregates recipient rows and computes the open rate over sent', async () => {
      prisma.notificationCampaign.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      prisma.notificationCampaignRecipient.groupBy.mockResolvedValue([
        { status: 'Sent', _count: { _all: 8 } },
        { status: 'Failed', _count: { _all: 1 } },
        { status: 'Skipped', _count: { _all: 3 } },
      ]);
      prisma.notificationCampaignRecipient.count.mockResolvedValue(2); // opened

      const result = await build().getCampaignRollup();
      expect(result.campaignsConsidered).toBe(2);
      expect(result.totalRecipients).toBe(12);
      expect(result.sent).toBe(8);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(3);
      expect(result.opened).toBe(2);
      expect(result.openRate).toBeCloseTo(0.25);
    });
  });

  describe('getQueueDepth', () => {
    it('reads live job counts for the three real queues', async () => {
      const result = await build().getQueueDepth();
      expect(result).toHaveLength(3);
      const verification = result.find((q) => q.queue === 'verification');
      expect(verification).toEqual({
        queue: 'verification',
        waiting: 1,
        active: 2,
        delayed: 3,
        completed: 4,
        failed: 5,
        available: true,
      });
    });

    it('degrades to zeros with available:false when a queue read throws', async () => {
      notificationsQueue.getJobCounts.mockRejectedValue(new Error('redis down'));
      const result = await build().getQueueDepth();
      const notifications = result.find((q) => q.queue === 'notifications');
      expect(notifications?.available).toBe(false);
      expect(notifications?.waiting).toBe(0);
    });
  });

  describe('getRecentActivity', () => {
    it('reuses AuditLogService.list sliced to the newest rows', async () => {
      auditLog.list.mockResolvedValue({ items: [{ id: 'a1' }], total: 1, page: 1, pageSize: 10 });
      const result = await build().getRecentActivity();
      expect(result).toEqual([{ id: 'a1' }]);
      expect(auditLog.list).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
    });
  });

  describe('getOverview caching', () => {
    function stubAllAggregates(): void {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.groupBy.mockResolvedValue([]);
      prisma.completion.groupBy.mockResolvedValue([]);
      prisma.completion.aggregate.mockResolvedValue({ _sum: { xpAwarded: null } });
      prisma.completion.count.mockResolvedValue(0);
      prisma.completion.findFirst.mockResolvedValue(null);
      prisma.report.count.mockResolvedValue(0);
      prisma.pushToken.groupBy.mockResolvedValue([]);
      prisma.notificationCampaign.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      auditLog.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    }

    it('computes on a cache miss and writes the block back with the configured TTL', async () => {
      stubAllAggregates();
      const result = await build().getOverview({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-08T00:00:00.000Z',
      });

      expect(result.range.from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(result.queueDepth).toHaveLength(3);
      expect(redis.get).toHaveBeenCalled();
      const [key, , mode, ttl] = redis.set.mock.calls[0];
      expect(key).toContain('analytics:overview:2026-07-01T00:00:00.000Z');
      expect(mode).toBe('EX');
      expect(ttl).toBe(300);
    });

    it('serves a cache hit without touching Postgres and revives the oldest-pending Date', async () => {
      const cached: AnalyticsKpiBlock = {
        users: {
          totalLive: 1,
          guests: 0,
          fullAccounts: 1,
          newInRange: 0,
          newInPreviousRange: 0,
          newChangePct: null,
          dailyRegistrations: [],
        },
        completions: {
          totalInRange: 0,
          byStatus: { pending: 0, approved: 0, rejected: 0 },
          xpAwardedInRange: 0,
          totalInPreviousRange: 0,
          changePct: null,
        },
        proofBacklog: {
          pendingCount: 1,
          oldestPendingAt: new Date('2026-07-02T00:00:00.000Z'),
          oldestPendingAgeHours: 5,
        },
        moderation: { openReports: 0, suspendedUsers: 0 },
        levelDistribution: [],
        activation: { cohortSize: 0, windows: [] },
        deviceTokens: [],
        campaigns: {
          campaignsConsidered: 0,
          totalRecipients: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          opened: 0,
          openRate: 0,
        },
      };
      redis.get.mockResolvedValue(JSON.stringify(cached));
      auditLog.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });

      const result = await build().getOverview({});

      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(result.proofBacklog.oldestPendingAt).toBeInstanceOf(Date);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('falls through to a live compute when the cache read throws', async () => {
      stubAllAggregates();
      redis.get.mockRejectedValue(new Error('connection refused'));
      await expect(build().getOverview({})).resolves.toBeDefined();
      expect(prisma.user.count).toHaveBeenCalled();
    });

    it('does not fail the request when the cache write throws', async () => {
      stubAllAggregates();
      redis.set.mockRejectedValue(new Error('connection refused'));
      await expect(build().getOverview({})).resolves.toBeDefined();
    });
  });

  describe('exportCsv', () => {
    it('serialises the KPI numbers, activation windows, and live queue depth', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(0);
      prisma.user.groupBy.mockResolvedValue([{ totalXp: 0, _count: { _all: 2 } }]);
      prisma.completion.groupBy.mockResolvedValue([]);
      prisma.completion.aggregate.mockResolvedValue({ _sum: { xpAwarded: 500 } });
      prisma.completion.count.mockResolvedValue(0);
      prisma.completion.findFirst.mockResolvedValue(null);
      prisma.report.count.mockResolvedValue(0);
      prisma.pushToken.groupBy.mockResolvedValue([{ platform: 'ios', _count: { _all: 4 } }]);
      prisma.notificationCampaign.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([{ activated: 0 }]);

      const csv = await build().exportCsv({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-08T00:00:00.000Z',
      });

      expect(csv.split('\n')[0]).toBe('metric,value');
      expect(csv).toContain('completions_xp_awarded_in_range,500');
      expect(csv).toContain('level_1_users,2');
      expect(csv).toContain('device_tokens_ios,4');
      expect(csv).toContain('activation_within_1d_count,0');
      expect(csv).toContain('queue_verification_waiting,1');
    });

    it('quotes a cell containing a comma (RFC-4180) rather than breaking the column layout', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(0);
      prisma.user.groupBy.mockResolvedValue([]);
      prisma.completion.groupBy.mockResolvedValue([]);
      prisma.completion.aggregate.mockResolvedValue({ _sum: { xpAwarded: null } });
      prisma.completion.count.mockResolvedValue(0);
      prisma.completion.findFirst.mockResolvedValue(null);
      prisma.report.count.mockResolvedValue(0);
      // A platform value carrying a comma (String column, not enum-constrained) must be quoted.
      prisma.pushToken.groupBy.mockResolvedValue([{ platform: 'weird,os', _count: { _all: 1 } }]);
      prisma.notificationCampaign.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([{ activated: 0 }]);

      const csv = await build().exportCsv({});
      expect(csv).toContain('"device_tokens_weird,os",1');
    });
  });
});
