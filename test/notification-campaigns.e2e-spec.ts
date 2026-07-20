import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Admin notification-campaigns e2e (Phase 11) against the local dev DB.
 *
 * The load-bearing test is the full lifecycle round trip: create a Draft →
 * preview the audience (no rows created) → send → poll until the `campaigns`
 * BullMQ queue has fanned it out → verify the recipient rows, the marketing
 * opt-out skip, the denormalized counters, and the real open metric. Also covers
 * RBAC gating (401/403), DTO validation (400), and the 409s (double-send, editing
 * a non-Draft campaign).
 *
 * The test audience is isolated from every other user in the shared dev DB by a
 * sentinel `totalXp` value (1_000_000) that no real user has, targeted via
 * `minTotalXp` — so the fan-out only ever touches this suite's fixtures.
 *
 * No new migration is required: NotificationCampaign / NotificationCampaignRecipient
 * and the `campaigns.*` permissions all shipped in earlier phases.
 */
describe('Admin notification campaigns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';
  const XP_SENTINEL = 1_000_000; // isolates this suite's audience
  const XP_NOBODY = 999_000_000; // a filter that matches no user at all

  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const userIds: string[] = [];
  const campaignIds: string[] = [];
  const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

  let managerToken: string;
  let viewerToken: string;

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
    const res = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: ADMIN_PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const auth = (token: string): string => `Bearer ${token}`;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function createCampaign(body: Record<string, unknown>): Promise<string> {
    const res = await request(server())
      .post('/admin/campaigns')
      .set('Authorization', auth(managerToken))
      .send(body)
      .expect(201);
    campaignIds.push(res.body.id);
    return res.body.id as string;
  }

  async function waitForStatus(
    id: string,
    target: string,
    timeoutMs = 20_000,
  ): Promise<Record<string, unknown>> {
    const terminal = ['Sent', 'Cancelled', 'Failed'];
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await request(server())
        .get(`/admin/campaigns/${id}`)
        .set('Authorization', auth(managerToken))
        .expect(200);
      if (res.body.status === target) return res.body;
      if (terminal.includes(res.body.status)) return res.body;
      await sleep(300);
    }
    throw new Error(`Timed out waiting for campaign ${id} to reach ${target}`);
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

    const keys = ['campaigns.view', 'campaigns.create', 'campaigns.send'];
    for (const key of keys) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e' },
      });
    }
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });

    const managerRole = await prisma.role.create({
      data: {
        key: `e2e-campaign-manager-${suffix}`,
        name: 'E2E Campaign Manager',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    const viewPerm = perms.find((p) => p.key === 'campaigns.view');
    const viewerRole = await prisma.role.create({
      data: {
        key: `e2e-campaign-viewer-${suffix}`,
        name: 'E2E Campaign Viewer',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: viewPerm ? [{ permissionId: viewPerm.id }] : [] },
      },
    });
    roleIds.push(managerRole.id, viewerRole.id);

    await makeAdmin(`campaign-manager-${suffix}@e2e.com`, managerRole.id);
    await makeAdmin(`campaign-viewer-${suffix}@e2e.com`, viewerRole.id);

    // Audience: three sentinel-XP users. A (no pref row) and B (marketing on) should
    // be delivered to; C (marketing off) should be skipped.
    const userA = await prisma.user.create({
      data: { isGuest: false, displayName: `camp-A-${suffix}`, totalXp: XP_SENTINEL },
      select: { id: true },
    });
    const userB = await prisma.user.create({
      data: { isGuest: false, displayName: `camp-B-${suffix}`, totalXp: XP_SENTINEL },
      select: { id: true },
    });
    const userC = await prisma.user.create({
      data: { isGuest: false, displayName: `camp-C-${suffix}`, totalXp: XP_SENTINEL },
      select: { id: true },
    });
    userIds.push(userA.id, userB.id, userC.id);

    await prisma.notificationPreference.create({
      data: { userId: userB.id, marketingEnabled: true },
    });
    await prisma.notificationPreference.create({
      data: { userId: userC.id, marketingEnabled: false },
    });
  });

  beforeEach(async () => {
    await resetThrottleState(app);
    managerToken = await adminLogin(`campaign-manager-${suffix}@e2e.com`);
    viewerToken = await adminLogin(`campaign-viewer-${suffix}@e2e.com`);
  });

  afterAll(async () => {
    await prisma.notificationCampaignRecipient.deleteMany({
      where: { campaignId: { in: campaignIds } },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  describe('auth + validation', () => {
    it('rejects unauthenticated access to the campaign list (401)', async () => {
      await request(server()).get('/admin/campaigns').expect(401);
    });

    it('lists campaigns for an admin with campaigns.view', async () => {
      const res = await request(server())
        .get('/admin/campaigns')
        .set('Authorization', auth(viewerToken))
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('forbids create for an admin without campaigns.create (403)', async () => {
      await request(server())
        .post('/admin/campaigns')
        .set('Authorization', auth(viewerToken))
        .send({ title: 'Nope', headline: 'H', body: 'B' })
        .expect(403);
    });

    it('rejects a create with an empty title (400)', async () => {
      await request(server())
        .post('/admin/campaigns')
        .set('Authorization', auth(managerToken))
        .send({ title: '', headline: 'H', body: 'B' })
        .expect(400);
    });

    it('returns 404 for a non-existent campaign detail', async () => {
      await request(server())
        .get(`/admin/campaigns/${NONEXISTENT_ID}`)
        .set('Authorization', auth(managerToken))
        .expect(404);
    });
  });

  describe('preview-audience', () => {
    it('resolves the saved filter to a count and creates no recipient rows', async () => {
      const id = await createCampaign({
        title: `Preview ${suffix}`,
        headline: 'H',
        body: 'B',
        targetFilter: { minTotalXp: XP_SENTINEL, maxTotalXp: XP_SENTINEL },
      });

      const res = await request(server())
        .post(`/admin/campaigns/${id}/preview-audience`)
        .set('Authorization', auth(viewerToken))
        .expect(200);
      expect(res.body.count).toBe(3);

      const rows = await prisma.notificationCampaignRecipient.count({ where: { campaignId: id } });
      expect(rows).toBe(0);
    });
  });

  describe('full send lifecycle', () => {
    it('create → send → fan-out: delivers to opted-in users, skips opt-outs, records real stats', async () => {
      const id = await createCampaign({
        title: `Broadcast ${suffix}`,
        headline: 'Big news',
        body: 'We shipped campaigns',
        data: { screen: 'home' },
        targetFilter: { minTotalXp: XP_SENTINEL, maxTotalXp: XP_SENTINEL },
      });

      await request(server())
        .post(`/admin/campaigns/${id}/send`)
        .set('Authorization', auth(managerToken))
        .expect(200);

      const detail = await waitForStatus(id, 'Sent');
      expect(detail.status).toBe('Sent');

      // Counters: 3 recipients, 2 delivered, 0 failed (C was skipped, not failed).
      const stats = detail.stats as Record<string, number>;
      expect(stats.totalRecipients).toBe(3);
      expect(stats.sent).toBe(2);
      expect(stats.skipped).toBe(1);
      expect(stats.failed).toBe(0);

      // Recipient rows reflect the same outcome, and the Sent rows carry a notification id.
      const recipients = await prisma.notificationCampaignRecipient.findMany({
        where: { campaignId: id },
      });
      expect(recipients).toHaveLength(3);
      const sentRows = recipients.filter((r) => r.status === 'Sent');
      const skippedRows = recipients.filter((r) => r.status === 'Skipped');
      expect(sentRows).toHaveLength(2);
      expect(skippedRows).toHaveLength(1);
      expect(sentRows.every((r) => r.notificationId !== null)).toBe(true);

      // A campaign_broadcast in-app notification was actually created per delivered user.
      const broadcasts = await prisma.notification.count({
        where: { userId: { in: userIds }, type: 'campaign_broadcast' },
      });
      expect(broadcasts).toBe(2);

      // Real open metric: mark one delivered notification read → openRate reflects it.
      const openedId = sentRows[0].notificationId as string;
      await prisma.notification.update({ where: { id: openedId }, data: { readAt: new Date() } });
      const reread = await request(server())
        .get(`/admin/campaigns/${id}`)
        .set('Authorization', auth(managerToken))
        .expect(200);
      const rereadStats = reread.body.stats as Record<string, number>;
      expect(rereadStats.openCount).toBe(1);
      expect(rereadStats.openRate).toBeCloseTo(0.5);
    });
  });

  describe('conflicts', () => {
    it('returns 409 on a double-send (second send sees a non-Draft campaign)', async () => {
      const id = await createCampaign({
        title: `DoubleSend ${suffix}`,
        headline: 'H',
        body: 'B',
        // Matches nobody, so this send is a harmless no-op fan-out.
        targetFilter: { minTotalXp: XP_NOBODY },
      });

      await request(server())
        .post(`/admin/campaigns/${id}/send`)
        .set('Authorization', auth(managerToken))
        .expect(200);

      await request(server())
        .post(`/admin/campaigns/${id}/send`)
        .set('Authorization', auth(managerToken))
        .expect(409);
    });

    it('returns 409 when editing a campaign that is no longer a Draft', async () => {
      const id = await createCampaign({
        title: `NoEdit ${suffix}`,
        headline: 'H',
        body: 'B',
        targetFilter: { minTotalXp: XP_NOBODY },
      });

      await request(server())
        .post(`/admin/campaigns/${id}/send`)
        .set('Authorization', auth(managerToken))
        .expect(200);

      await request(server())
        .patch(`/admin/campaigns/${id}`)
        .set('Authorization', auth(managerToken))
        .send({ title: 'Too late' })
        .expect(409);
    });

    it('soft-deletes a Draft but 409s on deleting a sent campaign', async () => {
      const draftId = await createCampaign({
        title: `DeleteMe ${suffix}`,
        headline: 'H',
        body: 'B',
      });
      await request(server())
        .delete(`/admin/campaigns/${draftId}`)
        .set('Authorization', auth(managerToken))
        .expect(204);
      await request(server())
        .get(`/admin/campaigns/${draftId}`)
        .set('Authorization', auth(managerToken))
        .expect(404);
    });
  });
});
