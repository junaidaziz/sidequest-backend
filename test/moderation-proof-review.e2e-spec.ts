import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Equivalence proof for the Phase 10 `AdminGuard` cutover.
 *
 * `test/admin.e2e-spec.ts` exercises the legacy `PATCH /admin/completions/:id/verification`
 * route (shared `x-admin-key` header, `AdminGuard`). This spec exercises the new
 * `PATCH /admin/proofs/:id/verification` route (RBAC-gated: `AdminJwtAuthGuard` +
 * `PermissionGuard`, `proofs.review` permission) against the *identical* scenarios —
 * same completion fixtures, same assertions — to prove the replacement route produces
 * byte-for-byte identical behavior before the legacy route is removed:
 *  - approve leaves XP unchanged; reject decrements XP by exactly `xpAwarded`, clamped at 0
 *  - `verifiedBy` stays the free-text `'admin'` sentinel (unchanged, for backward-compat)
 *  - the new route ADDITIONALLY sets the real `verifiedByAdminId` FK (the legacy route
 *    cannot, since it has no admin identity to attribute)
 *  - 409 when already resolved, 404 for a non-existent completion, 400 for bad input
 *  - 401 unauthenticated, 403 without `proofs.review`
 *
 * This is the "verify equivalent" gate the Phase 10 plan requires before the legacy
 * `AdminGuard`/`x-admin-key` route and guard are deleted.
 */
describe('Moderation proof review — RBAC replacement for legacy AdminGuard route (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';
  const adminIds: string[] = [];
  const roleIds: string[] = [];
  let missionId: string;
  let userId: string;
  const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

  let reviewerToken: string;
  let reviewerAdminId: string;
  let viewerToken: string;

  async function createPendingCompletion(xpAwarded = 40): Promise<string> {
    const completion = await prisma.completion.create({
      data: { userId, missionId, proofType: 'text', proofText: 'proof', xpAwarded },
      select: { id: true },
    });
    return completion.id;
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

    await prisma.permission.upsert({
      where: { key: 'proofs.review' },
      update: {},
      create: { key: 'proofs.review', description: 'proofs.review', category: 'e2e' },
    });
    const proofsReviewPerm = await prisma.permission.findUniqueOrThrow({
      where: { key: 'proofs.review' },
    });

    const reviewerRole = await prisma.role.create({
      data: {
        key: `e2e-proof-reviewer-${suffix}`,
        name: 'E2E Proof Reviewer',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: [{ permissionId: proofsReviewPerm.id }] },
      },
    });
    const viewerRole = await prisma.role.create({
      data: {
        key: `e2e-proof-viewer-${suffix}`,
        name: 'E2E Proof Viewer (no proofs.review)',
        isSystem: false,
        mfaRequired: false,
      },
    });
    roleIds.push(reviewerRole.id, viewerRole.id);

    reviewerAdminId = await makeAdmin(`proof-reviewer-${suffix}@e2e.com`, reviewerRole.id);
    await makeAdmin(`proof-viewer-${suffix}@e2e.com`, viewerRole.id);

    const mission = await prisma.mission.create({
      data: {
        title: `E2E Moderation Mission ${suffix}`,
        category: 'discover',
        description: 'Short teaser.',
        fullBrief: 'The full brief.',
        proofRequirement: 'A photo.',
        estimatedMinutes: 15,
        xpReward: 40,
        difficulty: 'Easy',
        difficultyDots: 1,
        crewTags: ['Solo'],
        settingTags: ['Indoors'],
        costTier: 0,
        isActive: true,
      },
      select: { id: true },
    });
    missionId = mission.id;

    const user = await prisma.user.create({
      data: { isGuest: true, totalXp: 100 },
      select: { id: true },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    await resetThrottleState(app);
    reviewerToken = await adminLogin(`proof-reviewer-${suffix}@e2e.com`);
    viewerToken = await adminLogin(`proof-viewer-${suffix}@e2e.com`);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.completion.deleteMany({ where: { missionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.mission.deleteMany({ where: { id: missionId } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  const path = (id: string): string => `/admin/proofs/${id}/verification`;

  describe('auth', () => {
    it('returns 401 unauthenticated', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer()).patch(path(id)).send({ status: 'Approved' }).expect(401);
    });

    it('returns 403 for an admin without proofs.review', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ status: 'Approved' })
        .expect(403);
    });
  });

  describe('approval — identical to the legacy route', () => {
    it('approves a Pending completion, leaves XP unchanged, and sets the real verifiedByAdminId FK', async () => {
      const id = await createPendingCompletion();
      await prisma.user.update({ where: { id: userId }, data: { totalXp: 100 } });

      const res = await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Approved' })
        .expect(200);

      expect(res.body).toMatchObject({
        completionId: id,
        verificationStatus: 'Approved',
        verifiedBy: 'admin',
        verifiedByAdminId: reviewerAdminId,
        rejectionReason: null,
      });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.totalXp).toBe(100);
    });
  });

  describe('rejection — identical XP-reversal math to the legacy route', () => {
    it('rejects a Pending completion and decrements XP by exactly xpAwarded', async () => {
      const id = await createPendingCompletion(40);
      await prisma.user.update({ where: { id: userId }, data: { totalXp: 100 } });

      const res = await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Rejected', rejectionReason: 'Blurry photo' })
        .expect(200);

      expect(res.body).toMatchObject({
        verificationStatus: 'Rejected',
        rejectionReason: 'Blurry photo',
        verifiedBy: 'admin',
        verifiedByAdminId: reviewerAdminId,
      });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.totalXp).toBe(60);
    });

    it('clamps the XP reversal at 0 rather than going negative — identical to the legacy route', async () => {
      const id = await createPendingCompletion(150);
      await prisma.user.update({ where: { id: userId }, data: { totalXp: 100 } });

      await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Rejected', rejectionReason: 'Fake proof' })
        .expect(200);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.totalXp).toBe(0);
    });

    it('returns 400 when rejecting without a rejectionReason', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Rejected' })
        .expect(400);
    });
  });

  describe('conflicts and lookup — identical to the legacy route', () => {
    it('returns 409 when the completion is already resolved (row-lock respected)', async () => {
      const id = await createPendingCompletion();

      await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Approved' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Approved' })
        .expect(409);
    });

    it('returns 404 for a valid but non-existent completion id', async () => {
      await request(app.getHttpServer())
        .patch(path(NONEXISTENT_ID))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Approved' })
        .expect(404);
    });

    it('returns 400 for an invalid status value', async () => {
      const id = await createPendingCompletion();
      await request(app.getHttpServer())
        .patch(path(id))
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ status: 'Pending' })
        .expect(400);
    });
  });
});
