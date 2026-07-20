import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { PermissionResolverService } from './../src/rbac/permission-resolver.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Per-admin permission-override management e2e (Phase 16 gap-closure) against the
 * local dev DB.
 *
 * The load-bearing proof is that an override actually changes an admin's
 * EFFECTIVE permission set with no stale-cache window: we probe a real gated
 * route (`GET /admin/admins`, which requires `admins.view`) with the target
 * admin's own token before and after each override write, expecting the status
 * to flip immediately — proving the role-version cache-bump fired.
 *
 *  - GRANT: a target whose role lacks `admins.view` is 403 → after a GRANT → 200
 *    → after removing the override → 403 again (reverted to role baseline).
 *  - REVOKE: a target whose role HAS `admins.view` is 200 → after a REVOKE → 403
 *    → after removing the override → 200 again (baseline restored — proving a
 *    removed override differs from a lingering REVOKE row).
 *
 * Also covers 401/403 gating (only `permissions.assign` may mutate; only
 * `admins.view` may read), 404 on unknown permission key / missing admin, 400
 * DTO validation, the upsert-not-duplicate semantics on the unique constraint,
 * and that the effective-set resolver reflects the change directly.
 *
 * No new migration is required: AdminUserPermissionOverride and the
 * `permissions.assign` / `admins.view` permissions all shipped in earlier phases.
 */
describe('Admin permission overrides (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let resolver: PermissionResolverService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';

  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

  // The acting admin holds `permissions.assign` (to mutate overrides) + `admins.view`.
  let actorToken: string;
  // A "viewer" holds only `admins.view` — enough to read, NOT to mutate overrides.
  let viewerToken: string;
  // Probe targets whose own tokens hit the gated `GET /admin/admins` route.
  let grantTargetToken: string;
  let grantTargetId: string;
  let revokeTargetToken: string;

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const auth = (token: string): string => `Bearer ${token}`;

  async function makeRole(key: string, permissionKeys: string[]): Promise<string> {
    const perms = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    const role = await prisma.role.create({
      data: {
        key: `${key}-${suffix}`,
        name: key,
        isSystem: false,
        mfaRequired: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    roleIds.push(role.id);
    return role.id;
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
    resolver = app.get(PermissionResolverService);
    await app.init();

    // Ensure the catalog permissions this suite relies on exist (they are seeded
    // in production, but the dev DB may not have been re-seeded).
    const keys = ['permissions.assign', 'admins.view'];
    for (const key of keys) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e' },
      });
    }

    const actorRoleId = await makeRole('e2e-perm-actor', ['permissions.assign', 'admins.view']);
    const viewerRoleId = await makeRole('e2e-perm-viewer', ['admins.view']);
    const grantTargetRoleId = await makeRole('e2e-perm-grant-target', []); // no admins.view
    const revokeTargetRoleId = await makeRole('e2e-perm-revoke-target', ['admins.view']);

    await makeAdmin(`perm-actor-${suffix}@e2e.com`, actorRoleId);
    await makeAdmin(`perm-viewer-${suffix}@e2e.com`, viewerRoleId);
    grantTargetId = await makeAdmin(`perm-grant-${suffix}@e2e.com`, grantTargetRoleId);
    await makeAdmin(`perm-revoke-${suffix}@e2e.com`, revokeTargetRoleId);
  });

  beforeEach(async () => {
    await resetThrottleState(app);
    actorToken = await adminLogin(`perm-actor-${suffix}@e2e.com`);
    viewerToken = await adminLogin(`perm-viewer-${suffix}@e2e.com`);
    grantTargetToken = await adminLogin(`perm-grant-${suffix}@e2e.com`);
    revokeTargetToken = await adminLogin(`perm-revoke-${suffix}@e2e.com`);
  });

  afterAll(async () => {
    await prisma.adminUserPermissionOverride.deleteMany({
      where: { adminUserId: { in: adminIds } },
    });
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.adminSession.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  describe('auth + gating', () => {
    it('rejects unauthenticated override reads (401)', async () => {
      await request(server()).get(`/admin/admins/${grantTargetId}/overrides`).expect(401);
    });

    it('forbids a mutation for an admin lacking permissions.assign (403)', async () => {
      await request(server())
        .put(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(viewerToken))
        .send({ effect: 'GRANT' })
        .expect(403);
    });

    it('allows an admins.view holder to read overrides (200)', async () => {
      const res = await request(server())
        .get(`/admin/admins/${grantTargetId}/overrides`)
        .set('Authorization', auth(viewerToken))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('validation + not-found', () => {
    it('404s on an unknown permission key', async () => {
      await request(server())
        .put(`/admin/admins/${grantTargetId}/overrides/does.not.exist`)
        .set('Authorization', auth(actorToken))
        .send({ effect: 'GRANT' })
        .expect(404);
    });

    it('404s on a missing admin', async () => {
      await request(server())
        .put(`/admin/admins/${NONEXISTENT_ID}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .send({ effect: 'GRANT' })
        .expect(404);
    });

    it('400s on an invalid effect', async () => {
      await request(server())
        .put(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .send({ effect: 'MAYBE' })
        .expect(400);
    });
  });

  describe('GRANT changes the effective set immediately (403 → 200 → 403)', () => {
    it('grants a role-absent permission, then removing it reverts to baseline', async () => {
      // Baseline: target's role lacks admins.view → the gated route is 403.
      await request(server())
        .get('/admin/admins')
        .set('Authorization', auth(grantTargetToken))
        .expect(403);
      expect(await resolver.hasAll(grantTargetId, ['admins.view'])).toBe(false);

      // GRANT the override.
      const created = await request(server())
        .put(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .send({ effect: 'GRANT', reason: 'temporary triage access' })
        .expect(200);
      expect(created.body.permissionKey).toBe('admins.view');
      expect(created.body.effect).toBe('GRANT');
      expect(created.body.reason).toBe('temporary triage access');

      // Effective set (resolver) and the real route both reflect it — no stale window.
      expect(await resolver.hasAll(grantTargetId, ['admins.view'])).toBe(true);
      await request(server())
        .get('/admin/admins')
        .set('Authorization', auth(grantTargetToken))
        .expect(200);

      // It shows up in the override list.
      const listed = await request(server())
        .get(`/admin/admins/${grantTargetId}/overrides`)
        .set('Authorization', auth(actorToken))
        .expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].permissionKey).toBe('admins.view');

      // Remove the override → reverts to the role baseline → 403 again.
      await request(server())
        .delete(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .expect(200);
      expect(await resolver.hasAll(grantTargetId, ['admins.view'])).toBe(false);
      await request(server())
        .get('/admin/admins')
        .set('Authorization', auth(grantTargetToken))
        .expect(403);

      // Delete is idempotent — a second remove is still a success, no error.
      await request(server())
        .delete(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .expect(200);
    });

    it('upserts (updates, not duplicates) on a repeat write to the same pair', async () => {
      await request(server())
        .put(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .send({ effect: 'GRANT' })
        .expect(200);
      await request(server())
        .put(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .send({ effect: 'REVOKE', reason: 'changed my mind' })
        .expect(200);

      const listed = await request(server())
        .get(`/admin/admins/${grantTargetId}/overrides`)
        .set('Authorization', auth(actorToken))
        .expect(200);
      // Still exactly one row for the pair — the effect was updated in place.
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].effect).toBe('REVOKE');
      expect(listed.body[0].reason).toBe('changed my mind');

      // Clean up so this test is order-independent from the one above.
      await request(server())
        .delete(`/admin/admins/${grantTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .expect(200);
    });
  });

  describe('REVOKE subtracts a role-granted permission (200 → 403 → 200)', () => {
    it('revokes a permission the role grants, then removal restores the baseline', async () => {
      // Baseline: target's role HAS admins.view → gated route is 200.
      await request(server())
        .get('/admin/admins')
        .set('Authorization', auth(revokeTargetToken))
        .expect(200);

      const revokeTargetId = adminIds[3];

      // REVOKE actively subtracts even though the role grants it.
      await request(server())
        .put(`/admin/admins/${revokeTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .send({ effect: 'REVOKE' })
        .expect(200);
      expect(await resolver.hasAll(revokeTargetId, ['admins.view'])).toBe(false);
      await request(server())
        .get('/admin/admins')
        .set('Authorization', auth(revokeTargetToken))
        .expect(403);

      // Removing the REVOKE row (distinct from writing GRANT) restores baseline.
      await request(server())
        .delete(`/admin/admins/${revokeTargetId}/overrides/admins.view`)
        .set('Authorization', auth(actorToken))
        .expect(200);
      expect(await resolver.hasAll(revokeTargetId, ['admins.view'])).toBe(true);
      await request(server())
        .get('/admin/admins')
        .set('Authorization', auth(revokeTargetToken))
        .expect(200);
    });
  });
});
