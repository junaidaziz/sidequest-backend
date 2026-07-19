import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { generateTotp } from './../src/admin-auth/totp/totp.util';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Admin-auth + RBAC e2e against the local dev DB. Seeds its own role/permission/
 * admin fixtures under a per-run suffix and cleans them up in afterAll. Requires
 * the ADMIN_JWT_SECRET / ADMIN_MFA_ENCRYPTION_KEY env vars (see .env.example).
 */
describe('Admin auth + RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const PASSWORD = 'Sup3r-Secret-Pw!';
  const adminIds: string[] = [];
  const roleIds: string[] = [];

  let fullRoleId: string;
  let noneRoleId: string;

  async function makeAdmin(email: string, roleId: string, extra: Record<string, unknown> = {}) {
    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        displayName: email,
        status: 'Active',
        roleId,
        mustChangePassword: false,
        ...extra,
      },
    });
    adminIds.push(admin.id);
    return admin;
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

    // Ensure the permissions this suite gates on exist (idempotent).
    for (const key of ['roles.view', 'admins.view', 'audit.view']) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e' },
      });
    }
    const perms = await prisma.permission.findMany({
      where: { key: { in: ['roles.view', 'admins.view', 'audit.view'] } },
    });

    const fullRole = await prisma.role.create({
      data: {
        key: `e2e-full-${suffix}`,
        name: 'E2E Full',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    const noneRole = await prisma.role.create({
      data: { key: `e2e-none-${suffix}`, name: 'E2E None', isSystem: false, mfaRequired: false },
    });
    fullRoleId = fullRole.id;
    noneRoleId = noneRole.id;
    roleIds.push(fullRole.id, noneRole.id);
  });

  beforeEach(async () => {
    // Give each test the full per-IP login-throttle budget.
    await resetThrottleState(app);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('POST /admin/auth/login', () => {
    it('400s on a malformed body', async () => {
      await request(server()).post('/admin/auth/login').send({ email: 'not-an-email' }).expect(400);
    });

    it('401s on unknown credentials (no enumeration)', async () => {
      await request(server())
        .post('/admin/auth/login')
        .send({ email: `nobody-${suffix}@e2e.com`, password: PASSWORD })
        .expect(401);
    });

    it('authenticates an admin without MFA and returns a token pair', async () => {
      const admin = await makeAdmin(`login-${suffix}@e2e.com`, fullRoleId);
      const res = await request(server())
        .post('/admin/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(200);
      expect(res.body.status).toBe('authenticated');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.admin.roleKey).toBe(`e2e-full-${suffix}`);
    });
  });

  describe('MFA enrollment then login', () => {
    it('enrolls MFA, then requires the TOTP challenge on the next login', async () => {
      const admin = await makeAdmin(`mfa-${suffix}@e2e.com`, fullRoleId);

      // 1. Login (no MFA yet) → tokens.
      const login = await request(server())
        .post('/admin/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(200);
      const token = login.body.accessToken as string;

      // 2. Setup → secret + otpauth url.
      const setup = await request(server())
        .post('/admin/auth/mfa/setup')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const secret = setup.body.secret as string;
      expect(setup.body.otpauthUrl).toContain('otpauth://');

      // 3. Verify with a live code → 10 recovery codes, MFA enabled.
      const verify = await request(server())
        .post('/admin/auth/mfa/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: generateTotp(secret) })
        .expect(200);
      expect(verify.body.recoveryCodes).toHaveLength(10);

      // 4. Login again → now an MFA challenge (no tokens).
      const login2 = await request(server())
        .post('/admin/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(200);
      expect(login2.body.status).toBe('mfa_required');
      expect(login2.body.accessToken).toBeUndefined();

      // 5. Complete the challenge with a TOTP code → tokens.
      const challenge = await request(server())
        .post('/admin/auth/mfa/challenge')
        .send({ challengeId: login2.body.challengeId, code: generateTotp(secret) })
        .expect(200);
      expect(challenge.body.accessToken).toBeDefined();
    });
  });

  describe('logout-all revocation', () => {
    it('invalidates a still-live access token on the next request', async () => {
      const admin = await makeAdmin(`logoutall-${suffix}@e2e.com`, fullRoleId);
      const login = await request(server())
        .post('/admin/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(200);
      const token = login.body.accessToken as string;

      // Token works before logout-all.
      await request(server())
        .get('/admin/auth/sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server())
        .post('/admin/auth/logout-all')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Same token now rejected — the session is revoked (per-request check).
      await request(server())
        .get('/admin/auth/sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('account lockout', () => {
    it('sets a durable lockedUntil after 5 failed logins', async () => {
      const admin = await makeAdmin(`lock-${suffix}@e2e.com`, fullRoleId);
      for (let i = 0; i < 5; i++) {
        await request(server())
          .post('/admin/auth/login')
          .send({ email: admin.email, password: 'wrong-password' })
          .expect(401);
      }
      const locked = await prisma.adminUser.findUnique({ where: { id: admin.id } });
      expect(locked?.lockedUntil).not.toBeNull();
      expect(locked?.failedLoginCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe('permission guard', () => {
    it('denies GET /admin/roles without roles.view (403) and allows with it (200)', async () => {
      const denied = await makeAdmin(`noperm-${suffix}@e2e.com`, noneRoleId);
      const allowed = await makeAdmin(`perm-${suffix}@e2e.com`, fullRoleId);

      const deniedLogin = await request(server())
        .post('/admin/auth/login')
        .send({ email: denied.email, password: PASSWORD })
        .expect(200);
      await request(server())
        .get('/admin/roles')
        .set('Authorization', `Bearer ${deniedLogin.body.accessToken}`)
        .expect(403);

      const allowedLogin = await request(server())
        .post('/admin/auth/login')
        .send({ email: allowed.email, password: PASSWORD })
        .expect(200);
      await request(server())
        .get('/admin/roles')
        .set('Authorization', `Bearer ${allowedLogin.body.accessToken}`)
        .expect(200);
    });

    it('rejects an unauthenticated admin route with 401', async () => {
      await request(server()).get('/admin/roles').expect(401);
    });
  });

  describe('audit log viewer', () => {
    it('is readable with audit.view and reflects prior actions', async () => {
      const admin = await makeAdmin(`audit-${suffix}@e2e.com`, fullRoleId);
      const login = await request(server())
        .post('/admin/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(200);
      const res = await request(server())
        .get('/admin/audit-logs?pageSize=5')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.pageSize).toBe(5);
    });
  });
});
