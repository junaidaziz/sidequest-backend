import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (docker-compose). Requires the M21
 * notifications migration to be applied first (npx prisma migrate deploy).
 * Push delivery is best-effort and never asserted here — the tokens registered
 * are deliberately non-Expo-format, so the delivery processor skips them and no
 * external Expo HTTP call is made.
 * TODO(test-infra): move to a throwaway test DB once one exists — see
 * backend/CLAUDE.md.
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdUserIds: string[] = [];

  async function createGuest(): Promise<{ token: string; userId: string }> {
    const res = await request(app.getHttpServer()).post('/auth/guest').expect(201);
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken, userId: res.body.user.id };
  }

  const auth = (token: string): string => `Bearer ${token}`;

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
  });

  beforeEach(async () => {
    await resetThrottleState(app);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      const ids = createdUserIds;
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.pushToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userTaskEvent.deleteMany({ where: { task: { creatorId: { in: ids } } } });
      await prisma.userTaskSubmission.deleteMany({ where: { task: { creatorId: { in: ids } } } });
      await prisma.userTask.deleteMany({
        where: { OR: [{ creatorId: { in: ids } }, { assigneeId: { in: ids } }] },
      });
      await prisma.idempotencyKey.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app.close();
  });

  describe('M21.2 — in-app CRUD', () => {
    it('starts empty and reports a zero unread count', async () => {
      const { token } = await createGuest();

      const list = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', auth(token))
        .expect(200);
      expect(list.body).toMatchObject({ items: [], total: 0, limit: 20, offset: 0 });

      const count = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', auth(token))
        .expect(200);
      expect(count.body).toEqual({ unreadCount: 0 });
    });

    it('marks one read and all read, scoped to the caller', async () => {
      const { token, userId } = await createGuest();
      // Seed two notifications directly (bypassing the trigger paths).
      await prisma.notification.createMany({
        data: [
          { userId, type: 'account_event', title: 'A', body: 'a' },
          { userId, type: 'account_event', title: 'B', body: 'b' },
        ],
      });

      const before = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', auth(token))
        .expect(200);
      expect(before.body.unreadCount).toBe(2);

      const list = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', auth(token))
        .expect(200);
      const firstId = list.body.items[0].id as string;

      await request(app.getHttpServer())
        .patch(`/notifications/${firstId}/read`)
        .set('Authorization', auth(token))
        .expect(200)
        .expect((res) => expect(res.body.readAt).not.toBeNull());

      const mid = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', auth(token))
        .expect(200);
      expect(mid.body.unreadCount).toBe(1);

      await request(app.getHttpServer())
        .post('/notifications/read-all')
        .set('Authorization', auth(token))
        .expect(200)
        .expect((res) => expect(res.body.updated).toBe(1));

      const after = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', auth(token))
        .expect(200);
      expect(after.body.unreadCount).toBe(0);
    });

    it("returns 404 marking a notification that is not the caller's", async () => {
      const owner = await createGuest();
      const other = await createGuest();
      const created = await prisma.notification.create({
        data: { userId: owner.userId, type: 'account_event', title: 'A', body: 'a' },
      });

      await request(app.getHttpServer())
        .patch(`/notifications/${created.id}/read`)
        .set('Authorization', auth(other.token))
        .expect(404);
    });
  });

  describe('M21.3 — push-token registration + logout deregistration', () => {
    it('re-registering the same token does not duplicate the row', async () => {
      const { token, userId } = await createGuest();
      const body = { token: 'device-token-abc', platform: 'ios' };

      await request(app.getHttpServer())
        .post('/notifications/push-tokens')
        .set('Authorization', auth(token))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/notifications/push-tokens')
        .set('Authorization', auth(token))
        .send({ ...body, deviceId: 'dev-1' })
        .expect(201);

      const rows = await prisma.pushToken.count({ where: { userId, token: 'device-token-abc' } });
      expect(rows).toBe(1);
    });

    it('logout deregisters the device push token (M21.3 acceptance)', async () => {
      const { token, userId } = await createGuest();
      await request(app.getHttpServer())
        .post('/notifications/push-tokens')
        .set('Authorization', auth(token))
        .send({ token: 'logout-token', platform: 'android' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', auth(token))
        .send({ pushToken: 'logout-token' })
        .expect(200);

      const rows = await prisma.pushToken.count({ where: { userId, token: 'logout-token' } });
      expect(rows).toBe(0);
    });

    it('deregisters a token via the DELETE endpoint', async () => {
      const { token, userId } = await createGuest();
      await request(app.getHttpServer())
        .post('/notifications/push-tokens')
        .set('Authorization', auth(token))
        .send({ token: 'delete-me', platform: 'ios' })
        .expect(201);

      await request(app.getHttpServer())
        .delete('/notifications/push-tokens/delete-me')
        .set('Authorization', auth(token))
        .expect(200)
        .expect((res) => expect(res.body).toMatchObject({ success: true, removed: 1 }));

      const rows = await prisma.pushToken.count({ where: { userId, token: 'delete-me' } });
      expect(rows).toBe(0);
    });
  });

  describe('preferences', () => {
    it('returns all-enabled defaults then persists a partial update', async () => {
      const { token } = await createGuest();

      const initial = await request(app.getHttpServer())
        .get('/notifications/preferences')
        .set('Authorization', auth(token))
        .expect(200);
      expect(initial.body).toEqual({
        pushEnabled: true,
        taskEventsEnabled: true,
        referralEventsEnabled: true,
        accountEventsEnabled: true,
      });

      await request(app.getHttpServer())
        .patch('/notifications/preferences')
        .set('Authorization', auth(token))
        .send({ pushEnabled: false })
        .expect(200)
        .expect((res) => expect(res.body.pushEnabled).toBe(false));

      const after = await request(app.getHttpServer())
        .get('/notifications/preferences')
        .set('Authorization', auth(token))
        .expect(200);
      expect(after.body.pushEnabled).toBe(false);
      expect(after.body.taskEventsEnabled).toBe(true);
    });
  });

  describe('M21.5 — task accept produces exactly one notification per party', () => {
    it('notifies the creator (task_accepted) and assignee (task_assigned) with deep links', async () => {
      const creator = await createGuest();
      const assignee = await createGuest();

      const task = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(creator.token))
        .send({ title: 'Shared quest' })
        .expect(201);
      const taskId = task.body.id as string;

      const invite = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/invite`)
        .set('Authorization', auth(creator.token))
        .expect(201);

      await request(app.getHttpServer())
        .post(`/tasks/invites/${invite.body.inviteToken}/accept`)
        .set('Authorization', auth(assignee.token))
        .expect(200);

      const creatorNotifs = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', auth(creator.token))
        .expect(200);
      expect(creatorNotifs.body.total).toBe(1);
      expect(creatorNotifs.body.items[0]).toMatchObject({
        type: 'task_accepted',
        data: { screen: 'task-detail', taskId },
      });

      const assigneeNotifs = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', auth(assignee.token))
        .expect(200);
      expect(assigneeNotifs.body.total).toBe(1);
      expect(assigneeNotifs.body.items[0]).toMatchObject({
        type: 'task_assigned',
        data: { screen: 'task-detail', taskId },
      });
    });
  });

  describe('unauthorized', () => {
    it('rejects an unauthenticated GET /notifications with 401', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401);
    });

    it('rejects an unauthenticated GET /notifications/unread-count with 401', async () => {
      await request(app.getHttpServer()).get('/notifications/unread-count').expect(401);
    });
  });
});
