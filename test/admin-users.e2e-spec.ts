import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Admin user-management e2e against the local dev DB (Phase 8).
 *
 * The load-bearing test here is the suspend → access-denied → reactivate →
 * access-restored round trip: it proves a *live* end-user access token actually
 * stops working the instant an admin suspends the account, and works again once
 * reactivated — not merely that a DB row flipped. Also covers RBAC gating (403),
 * unauthenticated access (401), and DTO validation (400).
 *
 * REQUIRES the `20260720120000_add_user_admin_moderation_fields` migration to be
 * applied to the target DB first (the suite exercises the new `suspendedAt`/
 * `restrictedFeatures` columns). This agent does not run migrations.
 */
describe('Admin user management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';
  const USER_PASSWORD = 'user-Passw0rd!';
  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const userIds: string[] = [];

  let managerToken: string;
  let viewerToken: string;
  let targetUserId: string;

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

  async function makeEndUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `enduser-${suffix}@e2e.com`,
        passwordHash: await bcrypt.hash(USER_PASSWORD, 12),
        displayName: 'End User',
        isGuest: false,
      },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function endUserLogin(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `enduser-${suffix}@e2e.com`, password: USER_PASSWORD })
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

    const keys = ['users.view', 'users.edit', 'users.suspend', 'users.delete', 'users.export'];
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
        key: `e2e-user-mgr-${suffix}`,
        name: 'E2E User Manager',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    // Viewer: users.view only (no suspend) — used for the 403 gating check.
    const viewPerm = perms.find((p) => p.key === 'users.view');
    const viewerRole = await prisma.role.create({
      data: {
        key: `e2e-user-viewer-${suffix}`,
        name: 'E2E User Viewer',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: viewPerm ? [{ permissionId: viewPerm.id }] : [] },
      },
    });
    roleIds.push(managerRole.id, viewerRole.id);

    await makeAdmin(`user-mgr-${suffix}@e2e.com`, managerRole.id);
    await makeAdmin(`user-viewer-${suffix}@e2e.com`, viewerRole.id);
    targetUserId = await makeEndUser();
  });

  beforeEach(async () => {
    await resetThrottleState(app);
    managerToken = await adminLogin(`user-mgr-${suffix}@e2e.com`);
    viewerToken = await adminLogin(`user-viewer-${suffix}@e2e.com`);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('rejects unauthenticated access to the admin user list (401)', async () => {
    await request(server()).get('/admin/users').expect(401);
  });

  it('lists users for an admin with users.view', async () => {
    const res = await request(server())
      .get('/admin/users')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('forbids suspend for an admin without users.suspend (403)', async () => {
    await request(server())
      .patch(`/admin/users/${targetUserId}/suspend`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ reason: 'nope' })
      .expect(403);
  });

  it('rejects a suspend with no reason (400)', async () => {
    await request(server())
      .patch(`/admin/users/${targetUserId}/suspend`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({})
      .expect(400);
  });

  it('suspend → access denied → reactivate → access restored (live token round trip)', async () => {
    // A live end-user token works before suspension.
    const userToken = await endUserLogin();
    await request(server()).get('/auth/me').set('Authorization', `Bearer ${userToken}`).expect(200);

    // Admin suspends the account.
    await request(server())
      .patch(`/admin/users/${targetUserId}/suspend`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ reason: 'abuse reports' })
      .expect(200);

    // The SAME, still-unexpired access token is now rejected on its next request.
    await request(server()).get('/auth/me').set('Authorization', `Bearer ${userToken}`).expect(401);

    // A suspended user cannot log in to mint a fresh token either.
    await request(server())
      .post('/auth/login')
      .send({ email: `enduser-${suffix}@e2e.com`, password: USER_PASSWORD })
      .expect(401);

    // Admin reactivates.
    await request(server())
      .patch(`/admin/users/${targetUserId}/reactivate`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    // Access is restored: the account can log in and use the API again.
    const restoredToken = await endUserLogin();
    await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${restoredToken}`)
      .expect(200);
  });

  it('applies and clears feature restrictions', async () => {
    const applied = await request(server())
      .patch(`/admin/users/${targetUserId}/restrict`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ features: ['proof_submission'], reason: 'spammy proofs' })
      .expect(200);
    expect(applied.body.restrictedFeatures).toEqual(['proof_submission']);

    const cleared = await request(server())
      .patch(`/admin/users/${targetUserId}/restrict`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ features: [], reason: 'appeal upheld' })
      .expect(200);
    expect(cleared.body.restrictedFeatures).toEqual([]);
  });

  it('rejects an unknown restriction key (400)', async () => {
    await request(server())
      .patch(`/admin/users/${targetUserId}/restrict`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ features: ['not_a_feature'], reason: 'x' })
      .expect(400);
  });

  it('returns the full profile for an admin with users.view', async () => {
    const res = await request(server())
      .get(`/admin/users/${targetUserId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(res.body.id).toBe(targetUserId);
    expect(Array.isArray(res.body.proofHistory)).toBe(true);
    expect(Array.isArray(res.body.challenges)).toBe(true);
    expect(res.body.moderation).toBeDefined();
  });

  it('exports the user data for an admin with users.export', async () => {
    const res = await request(server())
      .get(`/admin/users/${targetUserId}/export`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(res.body.profile.id).toBe(targetUserId);
    expect(res.body.referrals).toBeDefined();
  });
});
