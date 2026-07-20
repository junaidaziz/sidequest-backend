import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  ALL_CONTROLLERS,
  DiscoveredRoute,
  discoverRoutes,
  permissionSignature,
} from './support/permission-routes';
import { resetThrottleState } from './support/reset-throttle';

/**
 * RBAC permission-matrix acceptance gate (Phase 15).
 *
 * This is the platform-wide gate that proves every permission-gated admin route
 * actually enforces its permission — for every real permission key in the
 * catalog — rather than trusting each module's own spec. Crucially, the matrix
 * is built by INTROSPECTING each route's live `@RequirePermission` metadata (see
 * `support/permission-routes.ts`), not from a hand-copied list, so a newly-added
 * route with a missing or wrong permission fails this suite automatically.
 *
 * For every gated route it asserts, via real HTTP against a bootstrapped app:
 *   1. unauthenticated            -> 401
 *   2. authed WITHOUT the perm    -> 403
 *   3. authed WITH the perm       -> NOT 403/401 (whatever business outcome:
 *      200/400/404/409/422 all mean "the permission check passed")
 *
 * Roles are minimal throwaways: one role holding EXACTLY the permission set a
 * route requires (keyed by set signature), plus one baseline role holding
 * nothing. This isolates the guard mechanism itself; the seeded role→permission
 * assignments are a separate seed-data concern already exercised elsewhere.
 *
 * Ungated routes (no `@RequirePermission`) are enumerated in a report, split
 * into admin-surface (scrutinized) vs non-admin user/public (outside RBAC), and
 * do NOT fail the suite — being ungated is sometimes correct by design.
 */

const ALL_ROUTES = discoverRoutes();
const GATED_ROUTES = ALL_ROUTES.filter((route) => route.permissions.length > 0);
const UNGATED_ROUTES = ALL_ROUTES.filter((route) => route.permissions.length === 0);

// Every distinct permission SET that gates at least one route. Each becomes one
// throwaway role + admin that holds exactly that set.
const UNIQUE_PERMISSION_SETS = Array.from(
  new Map(GATED_ROUTES.map((route) => [permissionSignature(route.permissions), route.permissions])),
).map(([signature, permissions]) => ({ signature, permissions }));

jest.setTimeout(300_000);

describe('RBAC permission matrix — every gated route enforces its permission (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let discovery: DiscoveryService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';

  const adminIds: string[] = [];
  const roleIds: string[] = [];
  /** permission key -> Permission row id, populated during upsert. */
  const permissionIdByKey = new Map<string, string>();
  /** signature -> admin access token that holds exactly that permission set. */
  const tokenBySignature = new Map<string, string>();
  /** Token for an admin holding zero permissions (the denied baseline). */
  let baselineToken: string;

  async function adminLogin(email: string): Promise<string> {
    // Reset the login throttle before each login: with ~30 throwaway admins this
    // loop would otherwise trip the 5/60s per-IP login cap.
    await resetThrottleState(app);
    const res = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: ADMIN_PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function createRoleWithPermissions(
    label: string,
    permissionKeys: string[],
  ): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `e2e-permmatrix-${label}-${suffix}`,
        name: `E2E PermMatrix ${label}`,
        isSystem: false,
        // Must stay false: a truthy mfaRequired would set `mfaPending` on the
        // token and make PermissionGuard 403 for onboarding reasons, not the
        // permission check we are actually testing.
        mfaRequired: false,
        permissions: {
          create: permissionKeys.map((key) => {
            const permissionId = permissionIdByKey.get(key);
            if (!permissionId) {
              throw new Error(`Permission id not resolved for key "${key}"`);
            }
            return { permissionId };
          }),
        },
      },
      select: { id: true },
    });
    roleIds.push(role.id);
    return role.id;
  }

  async function createAdmin(email: string, roleId: string, passwordHash: string): Promise<string> {
    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        displayName: email,
        status: 'Active',
        roleId,
        mustChangePassword: false,
      },
      select: { id: true },
    });
    adminIds.push(admin.id);
    return admin.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // DiscoveryModule gives us NestJS's own controller registry for the
      // drift-guard check below.
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    prisma = app.get(PrismaService);
    discovery = app.get(DiscoveryService);
    await app.init();

    // Ensure every permission key referenced by the discovered routes exists
    // (the e2e DB may not be freshly seeded). Idempotent upsert, same convention
    // as the other RBAC e2e specs.
    const allKeys = Array.from(new Set(GATED_ROUTES.flatMap((route) => route.permissions)));
    for (const key of allKeys) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e-permmatrix' },
        select: { id: true },
      });
      permissionIdByKey.set(key, permission.id);
    }

    // One shared bcrypt hash for every throwaway admin — they all share the same
    // password, so hashing once keeps setup fast without weakening the login
    // path (login still runs a real bcrypt.compare).
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // Baseline "holds nothing" admin — the denied actor for every gated route.
    const baselineRoleId = await createRoleWithPermissions('baseline', []);
    const baselineEmail = `permmatrix-baseline-${suffix}@e2e.com`;
    await createAdmin(baselineEmail, baselineRoleId, passwordHash);

    // One admin per distinct permission set — the granted actor for routes
    // requiring that set.
    for (let i = 0; i < UNIQUE_PERMISSION_SETS.length; i++) {
      const { permissions } = UNIQUE_PERMISSION_SETS[i];
      const roleId = await createRoleWithPermissions(`set-${i}`, permissions);
      const email = `permmatrix-set-${i}-${suffix}@e2e.com`;
      await createAdmin(email, roleId, passwordHash);
    }

    // Log everyone in (throttle reset happens inside adminLogin).
    baselineToken = await adminLogin(baselineEmail);
    for (let i = 0; i < UNIQUE_PERMISSION_SETS.length; i++) {
      const { signature } = UNIQUE_PERMISSION_SETS[i];
      const email = `permmatrix-set-${i}-${suffix}@e2e.com`;
      tokenBySignature.set(signature, await adminLogin(email));
    }
  });

  beforeEach(async () => {
    // Each generated `it` makes at most one request, but the suite as a whole
    // hits hundreds of routes; resetting between cases keeps the shared global
    // throttler from tripping spurious 429s mid-run.
    await resetThrottleState(app);
  });

  afterAll(async () => {
    if (!app) {
      return;
    }
    // AuditLog has no cascade on AdminUser; delete those rows first (logins and
    // any incidental admin actions write them), then the admins (cascades their
    // sessions/overrides) and finally the throwaway roles.
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  it('discovered a non-trivial gated surface to test', () => {
    // Sanity guard: if introspection silently returned nothing (e.g. a metadata
    // key rename), every per-route assertion below would vacuously pass — fail
    // loudly instead.
    expect(GATED_ROUTES.length).toBeGreaterThan(20);
    expect(UNIQUE_PERMISSION_SETS.length).toBeGreaterThan(10);
  });

  it('every controller NestJS actually registered is covered by the matrix (drift guard)', () => {
    // DiscoveryService is the same machinery Nest uses to wire guards. If a new
    // controller is added to AppModule but not to ALL_CONTROLLERS, its routes
    // would be invisible to this matrix — catch that here rather than let RBAC
    // coverage silently rot.
    const registered = discovery
      .getControllers()
      .map((wrapper) => wrapper.metatype)
      .filter((metatype): metatype is NonNullable<typeof metatype> => Boolean(metatype))
      .map((metatype) => metatype.name);
    const known = new Set(ALL_CONTROLLERS.map((controller) => controller.name));
    const missing = registered.filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });

  describe('unauthenticated requests to gated routes are rejected (401)', () => {
    it.each(GATED_ROUTES)(
      '$method $fullPath [$permissions] -> 401 without a token',
      async (route: DiscoveredRoute) => {
        const res = await request(app.getHttpServer())[route.method](route.requestPath).send({});
        expect(res.status).toBe(401);
      },
    );
  });

  describe('an admin WITHOUT the required permission is forbidden (403)', () => {
    it.each(GATED_ROUTES)(
      '$method $fullPath [$permissions] -> 403 for the baseline (no-permission) admin',
      async (route: DiscoveredRoute) => {
        const res = await request(app.getHttpServer())
          [route.method](route.requestPath)
          .set('Authorization', `Bearer ${baselineToken}`)
          .send({});
        expect(res.status).toBe(403);
      },
    );
  });

  describe('an admin WITH the required permission passes the permission check (not 401/403)', () => {
    it.each(GATED_ROUTES)(
      '$method $fullPath [$permissions] -> permission check passes for the granted admin',
      async (route: DiscoveredRoute) => {
        const token = tokenBySignature.get(permissionSignature(route.permissions));
        expect(token).toBeDefined();
        const res = await request(app.getHttpServer())
          [route.method](route.requestPath)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        // We deliberately do NOT assert a 2xx: many routes need specific resource
        // state (hence the placeholder-UUID 404s / empty-body 400s). The signal
        // that matters is that the permission gate did not reject us.
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      },
    );
  });

  it('reports ungated routes for reviewer visibility (does not fail)', () => {
    const adminUngated = UNGATED_ROUTES.filter((route) => route.fullPath.startsWith('/admin'));
    const otherUngated = UNGATED_ROUTES.filter((route) => !route.fullPath.startsWith('/admin'));

    const format = (route: DiscoveredRoute): string =>
      `${route.method.toUpperCase().padEnd(6)} ${route.fullPath}  (${route.controllerName}.${route.handlerName})`;

    /* eslint-disable no-console */
    console.log(
      `\n[permission-matrix] ${ALL_ROUTES.length} routes discovered: ` +
        `${GATED_ROUTES.length} gated, ${UNGATED_ROUTES.length} ungated.`,
    );
    console.log(
      `[permission-matrix] gated across ${UNIQUE_PERMISSION_SETS.length} distinct permission set(s).`,
    );
    console.log(
      `\n[permission-matrix] Ungated /admin routes (${adminUngated.length}) — ` +
        'expected to be self-service admin-auth only; anything else is a potential RBAC gap:',
    );
    for (const route of adminUngated) {
      console.log(`  ${format(route)}`);
    }
    console.log(
      `\n[permission-matrix] Ungated non-admin routes (${otherUngated.length}) — ` +
        'user-JWT or public, outside the RBAC surface by design:',
    );
    for (const route of otherUngated) {
      console.log(`  ${format(route)}`);
    }
    /* eslint-enable no-console */

    // Guard rail: every ungated /admin route must be an intentional self-service
    // route — one that acts only on the CALLER's own account/identity, where a
    // permission gate would be wrong (a minimally-privileged admin must still be
    // able to log in, manage their own MFA, and read their own profile). Two such
    // surfaces exist by design, both still behind AdminJwtAuthGuard (so still 401
    // when unauthenticated):
    //   - `/admin/auth/*`     — login/refresh/logout/MFA/password/invitation
    //   - `/admin/admins/me`  — the caller's own profile + effective permissions
    // Any OTHER ungated /admin route is a genuine RBAC gap and fails here — this
    // is the one place ungated routes are not merely reported.
    const INTENTIONALLY_UNGATED_ADMIN_PATHS = new Set(['/admin/admins/me']);
    const suspicious = adminUngated.filter(
      (route) =>
        !route.fullPath.startsWith('/admin/auth') &&
        !INTENTIONALLY_UNGATED_ADMIN_PATHS.has(route.fullPath),
    );
    expect(suspicious.map(format)).toEqual([]);
  });
});
