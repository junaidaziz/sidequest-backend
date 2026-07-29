import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Admin mission-tag vocabulary CRUD e2e (closed-beta admin tooling).
 *
 * REQUIRES the `add_mission_tags_and_contact_submissions` migration to be applied
 * first (`npx prisma migrate dev`) — it reads/writes the new `MissionTag` table.
 *
 * Covers: RBAC gating (401 unauthenticated, 403 without challenges.manage_tags),
 * create + duplicate-409, list (active-only vs includeInactive + type filter),
 * update, and deactivate-not-delete (the row survives, flipped to isActive=false).
 */
describe('Admin mission tags (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';
  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const tagIds: string[] = [];

  let managerToken: string;
  let viewerToken: string;

  async function makeRole(label: string, permissionKeys: string[]): Promise<string> {
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    const role = await prisma.role.create({
      data: {
        key: `e2e-mtags-${label}-${suffix}`,
        name: `E2E MTags ${label}`,
        isSystem: false,
        mfaRequired: false,
        permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
    });
    roleIds.push(role.id);
    return role.id;
  }

  async function makeAdmin(email: string, roleId: string): Promise<void> {
    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
        displayName: email,
        status: 'Active',
        roleId,
        mustChangePassword: false,
      },
    });
    adminIds.push(admin.id);
  }

  async function login(email: string): Promise<string> {
    await resetThrottleState(app);
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
    await resetThrottleState(app);

    // Ensure the permission keys exist (the e2e DB may not be freshly seeded).
    for (const key of ['challenges.view', 'challenges.manage_tags']) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e' },
      });
    }

    const managerRole = await makeRole('manager', ['challenges.view', 'challenges.manage_tags']);
    const viewerRole = await makeRole('viewer', ['challenges.view']);
    const managerEmail = `mtags-manager-${suffix}@e2e.com`;
    const viewerEmail = `mtags-viewer-${suffix}@e2e.com`;
    await makeAdmin(managerEmail, managerRole);
    await makeAdmin(viewerEmail, viewerRole);
    managerToken = await login(managerEmail);
    viewerToken = await login(viewerEmail);
  });

  afterAll(async () => {
    await prisma.missionTag.deleteMany({ where: { id: { in: tagIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  const crewTagBody = { type: 'Crew', value: `E2ECrew-${suffix}`, label: 'E2E Crew' };

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer()).get('/admin/mission-tags').expect(401);
  });

  it('rejects a create without challenges.manage_tags with 403', async () => {
    await request(app.getHttpServer())
      .post('/admin/mission-tags')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(crewTagBody)
      .expect(403);
  });

  it('creates a tag (201) and rejects a duplicate (type,value) with 409', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/mission-tags')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(crewTagBody)
      .expect(201);
    expect(res.body).toMatchObject({ type: 'Crew', value: crewTagBody.value, isActive: true });
    tagIds.push(res.body.id);

    await request(app.getHttpServer())
      .post('/admin/mission-tags')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(crewTagBody)
      .expect(409);
  });

  it('rejects a create with a missing/invalid type via DTO validation (400)', async () => {
    await request(app.getHttpServer())
      .post('/admin/mission-tags')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ value: 'x', label: 'x' })
      .expect(400);
  });

  it('lists active tags for a viewer and filters by type', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/mission-tags?type=Crew')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(res.body.items.every((t: { type: string }) => t.type === 'Crew')).toBe(true);
    expect(res.body.items.some((t: { value: string }) => t.value === crewTagBody.value)).toBe(true);
  });

  it('updates a tag label', async () => {
    const id = tagIds[0];
    const res = await request(app.getHttpServer())
      .patch(`/admin/mission-tags/${id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ label: 'Updated Label' })
      .expect(200);
    expect(res.body.label).toBe('Updated Label');
  });

  it('deactivates (never deletes) a tag; the row survives with isActive=false', async () => {
    const id = tagIds[0];
    await request(app.getHttpServer())
      .delete(`/admin/mission-tags/${id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200)
      .expect((res) => expect(res.body.isActive).toBe(false));

    // The row is retained (deactivate, not hard-delete).
    const row = await prisma.missionTag.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);

    // And it is excluded from the default active-only list, included with includeInactive.
    const activeList = await request(app.getHttpServer())
      .get('/admin/mission-tags?type=Crew')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(activeList.body.items.some((t: { id: string }) => t.id === id)).toBe(false);

    const allList = await request(app.getHttpServer())
      .get('/admin/mission-tags?type=Crew&includeInactive=true')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(allList.body.items.some((t: { id: string }) => t.id === id)).toBe(true);
  });

  it('returns 404 deactivating an unknown tag id', async () => {
    await request(app.getHttpServer())
      .delete('/admin/mission-tags/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(404);
  });
});
