import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { MissionPoolService } from './../src/missions/mission-pool.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Admin challenge (Mission) management e2e against the local dev DB (Phase 9).
 *
 * The load-bearing test is the generator-visibility round trip: an admin-created
 * mission starts as a `Draft` invisible to `POST /missions/generate`, becomes
 * visible only after an explicit publish (which flips the derived `isActive`
 * flag the generator selects on), and disappears again on unpublish — all
 * verified end-to-end through the real generator, not just a DB read. Also covers
 * RBAC gating (403), unauthenticated access (401), DTO validation (400), the
 * duplicate/feature/archive lifecycle, and soft-delete history preservation.
 *
 * No new migration is required: the Mission admin-authoring columns
 * (`status`/`isActive`/`featured`/`approvedAt`/...) all shipped in Phase 3's
 * `20260719142411_add_moderation_and_mission_admin_fields` migration.
 *
 * The generate context (crew "Kids Mode" + setting "Indoors" + 15 min + Free) is
 * chosen so NO curated seed mission qualifies (the only Kids-Mode seed missions
 * are 20 and 30 minutes), which makes this suite's single published fixture the
 * lone qualifier — deterministically present in the ≤3 random sample.
 */
describe('Admin challenge management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let missionPool: MissionPoolService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';
  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const missionIds: string[] = [];
  const userIds: string[] = [];

  let editorToken: string;
  let viewerToken: string;

  const GENERATE_CONTEXT = {
    crew: 'Kids Mode',
    time: '15 min',
    setting: 'Indoors',
    budget: 'Free',
  };

  function missionBody(title: string): Record<string, unknown> {
    return {
      title,
      category: 'discover',
      description: 'Short teaser.',
      fullBrief: 'The full brief.',
      proofRequirement: 'A photo.',
      estimatedMinutes: 15,
      xpReward: 25,
      difficulty: 'Easy',
      difficultyDots: 1,
      crewTags: ['Kids Mode'],
      settingTags: ['Indoors'],
      costTier: 0,
    };
  }

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

  async function generateTitles(): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post('/missions/generate')
      .send(GENERATE_CONTEXT)
      .expect(200);
    return (res.body.missions as { title: string }[]).map((m) => m.title);
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
    missionPool = app.get(MissionPoolService);
    await app.init();

    const keys = [
      'challenges.view',
      'challenges.create',
      'challenges.edit',
      'challenges.delete',
      'challenges.publish',
      'challenges.feature',
    ];
    for (const key of keys) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e' },
      });
    }
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });

    const editorRole = await prisma.role.create({
      data: {
        key: `e2e-chal-editor-${suffix}`,
        name: 'E2E Challenge Editor',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    const viewPerm = perms.find((p) => p.key === 'challenges.view');
    const viewerRole = await prisma.role.create({
      data: {
        key: `e2e-chal-viewer-${suffix}`,
        name: 'E2E Challenge Viewer',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: viewPerm ? [{ permissionId: viewPerm.id }] : [] },
      },
    });
    roleIds.push(editorRole.id, viewerRole.id);

    await makeAdmin(`chal-editor-${suffix}@e2e.com`, editorRole.id);
    await makeAdmin(`chal-viewer-${suffix}@e2e.com`, viewerRole.id);
  });

  beforeEach(async () => {
    await resetThrottleState(app);
    editorToken = await adminLogin(`chal-editor-${suffix}@e2e.com`);
    viewerToken = await adminLogin(`chal-viewer-${suffix}@e2e.com`);
  });

  afterAll(async () => {
    await prisma.completion.deleteMany({ where: { missionId: { in: missionIds } } });
    await prisma.savedMission.deleteMany({ where: { missionId: { in: missionIds } } });
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    // Duplicated missions carry a "(Copy)"-suffixed title; sweep by author too.
    await prisma.mission.deleteMany({ where: { createdByAdminId: { in: adminIds } } });
    await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await missionPool.invalidate();
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('rejects unauthenticated access to the admin mission list (401)', async () => {
    await request(server()).get('/admin/missions').expect(401);
  });

  it('lists missions for an admin with challenges.view', async () => {
    const res = await request(server())
      .get('/admin/missions')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('forbids create for an admin without challenges.create (403)', async () => {
    await request(server())
      .post('/admin/missions')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(missionBody(`Forbidden ${suffix}`))
      .expect(403);
  });

  it('rejects a create with an out-of-vocab crew tag (400)', async () => {
    await request(server())
      .post('/admin/missions')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ ...missionBody(`Bad ${suffix}`), crewTags: ['Coworkers'] })
      .expect(400);
  });

  it('generator round trip: Draft is hidden → publish reveals → unpublish hides', async () => {
    const title = `E2E Roundtrip ${suffix}`;

    // Create — always a Draft, invisible to the generator.
    const created = await request(server())
      .post('/admin/missions')
      .set('Authorization', `Bearer ${editorToken}`)
      .send(missionBody(title))
      .expect(201);
    missionIds.push(created.body.id);
    expect(created.body.status).toBe('Draft');
    expect(created.body.isActive).toBe(false);
    await missionPool.invalidate();
    expect(await generateTitles()).not.toContain(title);

    // Publish — Published + isActive + approval stamp; now visible.
    const published = await request(server())
      .post(`/admin/missions/${created.body.id}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(200);
    expect(published.body.status).toBe('Published');
    expect(published.body.isActive).toBe(true);
    expect(published.body.approvedAt).toBeTruthy();
    expect(await generateTitles()).toContain(title);

    // Re-publishing a live mission is a 409.
    await request(server())
      .post(`/admin/missions/${created.body.id}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(409);

    // Unpublish — back to Draft, dropped from the generator.
    const unpublished = await request(server())
      .post(`/admin/missions/${created.body.id}/unpublish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(200);
    expect(unpublished.body.status).toBe('Draft');
    expect(unpublished.body.isActive).toBe(false);
    expect(await generateTitles()).not.toContain(title);
  });

  it('duplicates a mission as a fresh Draft with a (Copy) title', async () => {
    const created = await request(server())
      .post('/admin/missions')
      .set('Authorization', `Bearer ${editorToken}`)
      .send(missionBody(`E2E Dup Source ${suffix}`))
      .expect(201);
    missionIds.push(created.body.id);

    const dup = await request(server())
      .post(`/admin/missions/${created.body.id}/duplicate`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(201);
    missionIds.push(dup.body.id);

    expect(dup.body.id).not.toBe(created.body.id);
    expect(dup.body.title).toBe(`E2E Dup Source ${suffix} (Copy)`);
    expect(dup.body.status).toBe('Draft');
    expect(dup.body.approvedByAdminId).toBeNull();
  });

  it('features and unfeatures a mission', async () => {
    const created = await request(server())
      .post('/admin/missions')
      .set('Authorization', `Bearer ${editorToken}`)
      .send(missionBody(`E2E Feature ${suffix}`))
      .expect(201);
    missionIds.push(created.body.id);

    const featured = await request(server())
      .post(`/admin/missions/${created.body.id}/feature`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(200);
    expect(featured.body.featured).toBe(true);

    const unfeatured = await request(server())
      .post(`/admin/missions/${created.body.id}/unfeature`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(200);
    expect(unfeatured.body.featured).toBe(false);
  });

  it('soft-deletes without orphaning an existing completion, and drops it from the generator', async () => {
    const title = `E2E Delete ${suffix}`;
    const created = await request(server())
      .post('/admin/missions')
      .set('Authorization', `Bearer ${editorToken}`)
      .send(missionBody(title))
      .expect(201);
    const missionId = created.body.id as string;
    missionIds.push(missionId);

    // Publish so it is live, then attach a historical completion to it.
    await request(server())
      .post(`/admin/missions/${missionId}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(200);
    expect(await generateTitles()).toContain(title);

    const user = await prisma.user.create({
      data: { email: `chal-user-${suffix}@e2e.com`, displayName: 'U', isGuest: false },
    });
    userIds.push(user.id);
    const completion = await prisma.completion.create({
      data: {
        userId: user.id,
        missionId,
        proofType: 'text',
        proofText: 'done',
        xpAwarded: 25,
      },
    });

    // Soft-delete the mission.
    await request(server())
      .delete(`/admin/missions/${missionId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(204);

    // Historical completion still exists and still points at the (now soft-deleted) mission.
    const stillThere = await prisma.completion.findUnique({ where: { id: completion.id } });
    expect(stillThere).not.toBeNull();
    const missionRow = await prisma.mission.findUnique({ where: { id: missionId } });
    expect(missionRow?.deletedAt).toBeTruthy();
    expect(missionRow?.isActive).toBe(false);

    // Dropped from the generator; a second delete is a 404.
    expect(await generateTitles()).not.toContain(title);
    await request(server())
      .delete(`/admin/missions/${missionId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({})
      .expect(404);
  });
});
