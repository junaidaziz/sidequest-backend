import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Contact form e2e (closed-beta admin tooling): public POST /contact intake plus
 * the RBAC-gated admin triage surface.
 *
 * REQUIRES the `add_mission_tags_and_contact_submissions` migration to be applied
 * first (`npx prisma migrate dev`) — it reads/writes the new `ContactSubmission`
 * table.
 *
 * Covers: public submit (201, no auth), DTO validation (400), admin RBAC gating
 * (401/403), admin list + get + status update, and the ordering/status filter.
 */
describe('Contact form (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const ADMIN_PASSWORD = 'Sup3r-Secret-Pw!';
  const contactEmail = `e2e-contact-${suffix}@example.com`;
  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const submissionIds: string[] = [];

  let managerToken: string; // contact.view + contact.manage
  let viewerToken: string; // contact.view only

  async function makeRole(label: string, permissionKeys: string[]): Promise<string> {
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    const role = await prisma.role.create({
      data: {
        key: `e2e-contact-${label}-${suffix}`,
        name: `E2E Contact ${label}`,
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

    for (const key of ['contact.view', 'contact.manage']) {
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, category: 'e2e' },
      });
    }

    const managerRole = await makeRole('manager', ['contact.view', 'contact.manage']);
    const viewerRole = await makeRole('viewer', ['contact.view']);
    const managerEmail = `contact-manager-${suffix}@e2e.com`;
    const viewerEmail = `contact-viewer-${suffix}@e2e.com`;
    await makeAdmin(managerEmail, managerRole);
    await makeAdmin(viewerEmail, viewerRole);
    managerToken = await login(managerEmail);
    viewerToken = await login(viewerEmail);
  });

  afterAll(async () => {
    await prisma.contactSubmission.deleteMany({ where: { id: { in: submissionIds } } });
    await prisma.contactSubmission.deleteMany({ where: { email: contactEmail } });
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  const body = {
    name: 'Ada Lovelace',
    email: contactEmail,
    topic: 'Partnership enquiry',
    message: 'I would love to discuss a partnership.',
  };

  it('accepts a public submission with no auth (201) and persists it', async () => {
    await resetThrottleState(app);
    const res = await request(app.getHttpServer()).post('/contact').send(body).expect(201);
    expect(res.body).toMatchObject({ success: true });
    expect(res.body.id).toBeTruthy();
    submissionIds.push(res.body.id);

    const row = await prisma.contactSubmission.findUnique({ where: { id: res.body.id } });
    expect(row).toMatchObject({ email: contactEmail, status: 'New' });
  });

  it('rejects a submission missing required fields (400)', async () => {
    await resetThrottleState(app);
    await request(app.getHttpServer())
      .post('/contact')
      .send({ name: 'x', email: 'not-an-email' })
      .expect(400);
  });

  it('rejects the admin list without a token (401)', async () => {
    await request(app.getHttpServer()).get('/admin/contact-submissions').expect(401);
  });

  it('rejects a status update without contact.manage (403)', async () => {
    const id = submissionIds[0];
    await request(app.getHttpServer())
      .patch(`/admin/contact-submissions/${id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ status: 'Read' })
      .expect(403);
  });

  it('lets a viewer list and view submissions', async () => {
    const list = await request(app.getHttpServer())
      .get('/admin/contact-submissions?status=New')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(list.body.items.some((s: { id: string }) => s.id === submissionIds[0])).toBe(true);

    await request(app.getHttpServer())
      .get(`/admin/contact-submissions/${submissionIds[0]}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200)
      .expect((res) => expect(res.body.email).toBe(contactEmail));
  });

  it('lets a manager update the triage status', async () => {
    const id = submissionIds[0];
    await request(app.getHttpServer())
      .patch(`/admin/contact-submissions/${id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'Resolved' })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('Resolved'));

    const row = await prisma.contactSubmission.findUnique({ where: { id } });
    expect(row?.status).toBe('Resolved');
  });

  it('returns 404 updating an unknown submission id', async () => {
    await request(app.getHttpServer())
      .patch('/admin/contact-submissions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'Read' })
      .expect(404);
  });
});
