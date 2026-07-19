import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * CMS + app-config e2e against the local dev DB. Seeds its own role/admin under a
 * per-run suffix, exercises the admin-write → publish → public-read round trip
 * (FAQ as the representative content type), the app-config public-key round trip,
 * per-type section-data validation, and permission gating. Cleans up in afterAll.
 */
describe('CMS + app-config (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const PASSWORD = 'Sup3r-Secret-Pw!';
  const adminIds: string[] = [];
  const roleIds: string[] = [];
  const faqIds: string[] = [];
  const configKeys: string[] = [];

  let editorToken: string;
  let viewerToken: string;

  async function makeAdmin(email: string, roleId: string): Promise<string> {
    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        displayName: email,
        status: 'Active',
        roleId,
        mustChangePassword: false,
      },
    });
    adminIds.push(admin.id);
    return admin.id;
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: PASSWORD })
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

    const keys = ['cms.view', 'cms.edit', 'cms.publish', 'app_config.view', 'app_config.manage'];
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
        key: `e2e-cms-editor-${suffix}`,
        name: 'E2E CMS Editor',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    // Viewer: cms.view only (no edit) — used for the 403 gating check.
    const viewPerm = perms.find((p) => p.key === 'cms.view');
    const viewerRole = await prisma.role.create({
      data: {
        key: `e2e-cms-viewer-${suffix}`,
        name: 'E2E CMS Viewer',
        isSystem: false,
        mfaRequired: false,
        permissions: { create: viewPerm ? [{ permissionId: viewPerm.id }] : [] },
      },
    });
    roleIds.push(editorRole.id, viewerRole.id);

    const editorId = await makeAdmin(`cms-editor-${suffix}@e2e.com`, editorRole.id);
    const viewerId = await makeAdmin(`cms-viewer-${suffix}@e2e.com`, viewerRole.id);
    void editorId;
    void viewerId;
  });

  beforeEach(async () => {
    await resetThrottleState(app);
    editorToken = await login(`cms-editor-${suffix}@e2e.com`);
    viewerToken = await login(`cms-viewer-${suffix}@e2e.com`);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await prisma.cmsFaq.deleteMany({ where: { id: { in: faqIds } } });
    if (configKeys.length > 0) {
      await prisma.appConfig.deleteMany({ where: { key: { in: configKeys } } });
    }
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('FAQ round trip: create (draft) → not public → publish → public', async () => {
    const created = await request(server())
      .post('/admin/cms/faqs')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ question: `Where do I log in? ${suffix}`, answer: 'In the app.' })
      .expect(201);
    const id = created.body.id as string;
    faqIds.push(id);
    expect(created.body.status).toBe('Draft');

    // Draft is invisible to the public endpoint.
    const beforePublish = await request(server()).get('/cms/faqs').expect(200);
    expect((beforePublish.body as Array<{ id: string }>).some((f) => f.id === id)).toBe(false);

    // Publish requires cms.publish (the editor role has it).
    const published = await request(server())
      .post(`/admin/cms/faqs/${id}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200); // publish is a state transition, not a creation
    expect(published.body.status).toBe('Published');

    const afterPublish = await request(server()).get('/cms/faqs').expect(200);
    expect((afterPublish.body as Array<{ id: string }>).some((f) => f.id === id)).toBe(true);
  });

  it('denies a create without cms.edit (403) and a public read needs no auth', async () => {
    await request(server())
      .post('/admin/cms/faqs')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ question: 'x', answer: 'y' })
      .expect(403);

    // Public read is unauthenticated.
    await request(server()).get('/cms/faqs').expect(200);
    await request(server()).get('/admin/cms/faqs').expect(401);
  });

  it('rejects a section whose data does not match its type (400)', async () => {
    await request(server())
      .post('/admin/cms/sections')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ key: `home.hero.${suffix}`, type: 'Hero', data: { headline: 'x', evil: '<script>' } })
      .expect(400);
  });

  it('app-config round trip: upsert public key → public map', async () => {
    const key = 'appStoreUrl';
    configKeys.push(key);
    await request(server())
      .put(`/admin/config/${key}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ value: `https://apps.apple.com/${suffix}` })
      .expect(200);

    const pub = await request(server()).get('/config/public').expect(200);
    expect(pub.body.config[key]).toBe(`https://apps.apple.com/${suffix}`);
  });
});
