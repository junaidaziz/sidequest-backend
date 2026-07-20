import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Admin analytics dashboard e2e (Phase 12) against the local dev DB.
 *
 * Global aggregates (totalLive, level distribution, queue depth, etc.) can't be
 * asserted to exact values in a shared dev DB, so this suite pins the DATE-SCOPED
 * metrics instead: it seeds a 3-user cohort into a far-past window whose bounds are
 * made unique per run (a year-2001 anchor + a per-run offset). That window contains
 * none of the dev DB's real users AND yields a unique analytics cache key per run,
 * so `newInRange`, the completion breakdown, XP sum, and the activation cohort come
 * back as exactly the seeded numbers. Structural shape (all sections present, the
 * three named queues, CSV headers) is asserted for the global metrics.
 *
 * No new migration is required: every column read and the analytics.* permissions
 * shipped in earlier phases.
 */
describe('Admin analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';

  // Per-run-unique, real-user-free window in Jan 2001.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const anchorMs = Date.UTC(2001, 0, 1) + (suffix % 1_000_000_000);
  const fromISO = new Date(anchorMs).toISOString();
  const toISO = new Date(anchorMs + 7 * DAY_MS).toISOString();

  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const userIds: string[] = [];
  const missionIds: string[] = [];

  let viewerToken: string;
  let exporterToken: string;

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const auth = (token: string): string => `Bearer ${token}`;

  async function makeAdmin(email: string, roleId: string): Promise<string> {
    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
        displayName: email,
        status: 'Active',
        roleId,
        mustChangePassword: false,
      },
    });
    adminIds.push(admin.id);
    return admin.id;
  }

  async function adminLogin(email: string): Promise<string> {
    const res = await request(server())
      .post('/admin/auth/login')
      .send({ email, password: ADMIN_PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = app.get(PrismaService);
    await app.init();

    // Permissions + two roles: a view-only role and a view+export role.
    const keys = ['analytics.view', 'analytics.export'];
    for (const key of keys) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e' },
      });
    }
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    const viewPerm = perms.find((p) => p.key === 'analytics.view');

    const viewerRole = await prisma.role.create({
      data: {
        key: `e2e-analytics-viewer-${suffix}`,
        name: 'E2E Analytics Viewer',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: viewPerm ? [{ permissionId: viewPerm.id }] : [] },
      },
    });
    const exporterRole = await prisma.role.create({
      data: {
        key: `e2e-analytics-exporter-${suffix}`,
        name: 'E2E Analytics Exporter',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    roleIds.push(viewerRole.id, exporterRole.id);

    await makeAdmin(`analytics-viewer-${suffix}@e2e.com`, viewerRole.id);
    await makeAdmin(`analytics-exporter-${suffix}@e2e.com`, exporterRole.id);

    // Fixture mission for the completions to reference.
    const mission = await prisma.mission.create({
      data: {
        title: `Analytics Fixture Mission ${suffix}`,
        category: 'explore',
        description: 'x',
        fullBrief: 'x',
        proofRequirement: 'x',
        estimatedMinutes: 10,
        xpReward: 40,
        difficulty: 'Easy',
        difficultyDots: 1,
        crewTags: ['Solo'],
        settingTags: ['Outdoors'],
        costTier: 0,
      },
      select: { id: true },
    });
    missionIds.push(mission.id);

    // Cohort: A registers day 0 and completes +12h (activates within 1 day, Approved);
    // B registers day 1 and completes +4 days (activates within 7, not 1, Pending);
    // C registers day 2 and never completes (never activates).
    const userA = await prisma.user.create({
      data: { isGuest: false, displayName: `an-A-${suffix}`, createdAt: new Date(anchorMs) },
      select: { id: true },
    });
    const userB = await prisma.user.create({
      data: {
        isGuest: false,
        displayName: `an-B-${suffix}`,
        createdAt: new Date(anchorMs + DAY_MS),
      },
      select: { id: true },
    });
    const userC = await prisma.user.create({
      data: {
        isGuest: false,
        displayName: `an-C-${suffix}`,
        createdAt: new Date(anchorMs + 2 * DAY_MS),
      },
      select: { id: true },
    });
    userIds.push(userA.id, userB.id, userC.id);

    await prisma.completion.create({
      data: {
        userId: userA.id,
        missionId: mission.id,
        proofType: 'text',
        proofText: 'a',
        xpAwarded: 40,
        completedAt: new Date(anchorMs + DAY_MS / 2),
        verificationStatus: 'Approved',
      },
    });
    await prisma.completion.create({
      data: {
        userId: userB.id,
        missionId: mission.id,
        proofType: 'text',
        proofText: 'b',
        xpAwarded: 60,
        completedAt: new Date(anchorMs + DAY_MS + 4 * DAY_MS),
        verificationStatus: 'Pending',
      },
    });

    // One enabled device token so the platform breakdown has a known member.
    await prisma.pushToken.create({
      data: { userId: userA.id, token: `an-token-${suffix}`, platform: 'ios' },
    });
  });

  beforeEach(async () => {
    await resetThrottleState(app);
    viewerToken = await adminLogin(`analytics-viewer-${suffix}@e2e.com`);
    exporterToken = await adminLogin(`analytics-exporter-${suffix}@e2e.com`);
  });

  afterAll(async () => {
    await prisma.completion.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pushToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  describe('auth + validation', () => {
    it('rejects unauthenticated access to the overview (401)', async () => {
      await request(server()).get('/admin/analytics/overview').expect(401);
    });

    it('allows a viewer to read the overview (200)', async () => {
      await request(server())
        .get('/admin/analytics/overview')
        .set('Authorization', auth(viewerToken))
        .expect(200);
    });

    it('forbids a view-only admin from exporting (403)', async () => {
      await request(server())
        .get('/admin/analytics/export')
        .set('Authorization', auth(viewerToken))
        .expect(403);
    });

    it('rejects a malformed from date (400)', async () => {
      await request(server())
        .get('/admin/analytics/overview?from=not-a-date')
        .set('Authorization', auth(viewerToken))
        .expect(400);
    });

    it('rejects an inverted range (400)', async () => {
      await request(server())
        .get(`/admin/analytics/overview?from=${toISO}&to=${fromISO}`)
        .set('Authorization', auth(viewerToken))
        .expect(400);
    });
  });

  describe('overview aggregates', () => {
    it('returns the exact date-scoped cohort numbers and the full section shape', async () => {
      const res = await request(server())
        .get(`/admin/analytics/overview?from=${fromISO}&to=${toISO}`)
        .set('Authorization', auth(viewerToken))
        .expect(200);
      const body = res.body;

      // Range echoes the resolved window.
      expect(new Date(body.range.from).toISOString()).toBe(fromISO);
      expect(new Date(body.range.to).toISOString()).toBe(toISO);

      // Users: exactly the 3 seeded, no previous-window registrations.
      expect(body.users.newInRange).toBe(3);
      expect(body.users.newInPreviousRange).toBe(0);
      expect(body.users.newChangePct).toBeNull();
      expect(body.users.dailyRegistrations).toHaveLength(3);
      expect(body.users.dailyRegistrations.every((d: { count: number }) => d.count === 1)).toBe(
        true,
      );

      // Completions: 2 in range (1 Approved, 1 Pending), 100 XP, no previous window.
      expect(body.completions.totalInRange).toBe(2);
      expect(body.completions.byStatus).toEqual({ pending: 1, approved: 1, rejected: 0 });
      expect(body.completions.xpAwardedInRange).toBe(100);
      expect(body.completions.totalInPreviousRange).toBe(0);
      expect(body.completions.changePct).toBeNull();

      // Activation: cohort of 3; A within 1 day, A+B within 7/30.
      expect(body.activation.cohortSize).toBe(3);
      const byWindow = Object.fromEntries(
        body.activation.windows.map((w: { windowDays: number; activatedCount: number }) => [
          w.windowDays,
          w.activatedCount,
        ]),
      );
      expect(byWindow).toEqual({ 1: 1, 7: 2, 30: 2 });
      const within1 = body.activation.windows.find(
        (w: { windowDays: number }) => w.windowDays === 1,
      );
      expect(within1.rate).toBeCloseTo(1 / 3);

      // Structural: every section present.
      expect(body.proofBacklog).toBeDefined();
      expect(body.moderation).toBeDefined();
      expect(Array.isArray(body.levelDistribution)).toBe(true);
      expect(Array.isArray(body.deviceTokens)).toBe(true);
      expect(body.campaigns).toBeDefined();
      expect(Array.isArray(body.recentActivity)).toBe(true);

      // Device tokens include the seeded ios token.
      const ios = body.deviceTokens.find((d: { platform: string }) => d.platform === 'ios');
      expect(ios).toBeDefined();
      expect(ios.count).toBeGreaterThanOrEqual(1);

      // Live queue depth for the three real queues, each best-effort available.
      expect(body.queueDepth).toHaveLength(3);
      const names = body.queueDepth.map((q: { queue: string }) => q.queue).sort();
      expect(names).toEqual(['campaigns', 'notifications', 'verification']);
      expect(body.queueDepth.every((q: { available: boolean }) => q.available === true)).toBe(true);
    });
  });

  describe('CSV export', () => {
    it('streams a text/csv body with the computed KPI rows', async () => {
      const res = await request(server())
        .get(`/admin/analytics/export?from=${fromISO}&to=${toISO}`)
        .set('Authorization', auth(exporterToken))
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      const csv = res.text;
      expect(csv.split('\n')[0]).toBe('metric,value');
      expect(csv).toContain('users_new_in_range,3');
      expect(csv).toContain('completions_xp_awarded_in_range,100');
      expect(csv).toContain('activation_cohort_size,3');
    });
  });
});
