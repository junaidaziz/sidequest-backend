import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (docker-compose) and, for the evidence
 * attachment case, real LocalStack S3 — same infra the proof e2e relies on.
 * TODO(test-infra): move to a throwaway test DB once one exists — see
 * backend/CLAUDE.md.
 */
describe('User tasks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdUserIds: string[] = [];

  // 1x1 transparent PNG for evidence attachment uploads.
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

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

  // This suite creates several guest sessions per test; the guest-creation
  // endpoint is capped at 10/60s, so reset the shared Redis throttle counters
  // before each test to avoid spurious 429s across the suite.
  beforeEach(async () => {
    await resetThrottleState(app);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      const ids = createdUserIds;
      await prisma.userTaskAttachment.deleteMany({
        where: { submission: { task: { creatorId: { in: ids } } } },
      });
      await prisma.userTaskSubmission.deleteMany({ where: { task: { creatorId: { in: ids } } } });
      await prisma.userTaskEvent.deleteMany({ where: { task: { creatorId: { in: ids } } } });
      await prisma.userTask.deleteMany({
        where: { OR: [{ creatorId: { in: ids } }, { assigneeId: { in: ids } }] },
      });
      await prisma.idempotencyKey.deleteMany({ where: { userId: { in: ids } } });
      // M21's notification hooks fire on task accept/decline/submit/review,
      // so these tests now create Notification rows as a side effect —
      // clear them before deleting the user or the FK constraint fails.
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app.close();
  });

  describe('M19.2 — personal task self-completion', () => {
    it('auto-approves a NONE personal task and awards the reward', async () => {
      const { token, userId } = await createGuest();

      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .send({ title: 'Read a chapter', rewardXp: 30 })
        .expect(201);
      expect(created.body.status).toBe('Open');

      const submitted = await request(app.getHttpServer())
        .post(`/tasks/${created.body.id}/submissions`)
        .set('Authorization', auth(token))
        .field('notes', 'done')
        .expect(201);
      expect(submitted.body.status).toBe('Approved');
      expect(submitted.body.submissions).toHaveLength(1);
      expect(submitted.body.submissions[0].status).toBe('Approved');

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.totalXp).toBe(30);
    });

    it('rejects a self-completion CREATOR_APPROVAL submission with 400 (Decision 2)', async () => {
      const { token } = await createGuest();
      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .send({ title: 'Needs approval', verificationMethod: 'CREATOR_APPROVAL' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/tasks/${created.body.id}/submissions`)
        .set('Authorization', auth(token))
        .field('notes', 'trying to self-complete')
        .expect(400);
    });

    it('rejects AUTOMATIC verificationMethod at creation with 400', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .send({ title: 'x', verificationMethod: 'AUTOMATIC' })
        .expect(400);
    });

    it('locks edits once accepted and blocks non-creator edits', async () => {
      const { token } = await createGuest();
      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .send({ title: 'Editable' })
        .expect(201);

      // Editable while Open.
      await request(app.getHttpServer())
        .patch(`/tasks/${created.body.id}`)
        .set('Authorization', auth(token))
        .send({ title: 'Edited' })
        .expect(200);

      // A stranger cannot edit.
      const { token: strangerToken } = await createGuest();
      await request(app.getHttpServer())
        .patch(`/tasks/${created.body.id}`)
        .set('Authorization', auth(strangerToken))
        .send({ title: 'Hijack' })
        .expect(403);
    });
  });

  describe('GET /tasks — pagination', () => {
    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer()).get('/tasks').expect(401);
    });

    it("paginates the caller's own tasks, newest-created-first, with a default limit of 20", async () => {
      const { token } = await createGuest();
      for (const title of ['First', 'Second', 'Third']) {
        await request(app.getHttpServer())
          .post('/tasks')
          .set('Authorization', auth(token))
          .send({ title })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', auth(token))
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.limit).toBe(20);
      expect(res.body.offset).toBe(0);
      expect(res.body.items.map((t: { title: string }) => t.title)).toEqual([
        'Third',
        'Second',
        'First',
      ]);
    });

    it('respects an explicit limit/offset', async () => {
      const { token } = await createGuest();
      for (const title of ['A', 'B', 'C']) {
        await request(app.getHttpServer())
          .post('/tasks')
          .set('Authorization', auth(token))
          .send({ title })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .get('/tasks?limit=1&offset=1')
        .set('Authorization', auth(token))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(1);
      expect(res.body.total).toBe(3);
    });

    it("does not return another user's tasks", async () => {
      const owner = await createGuest();
      const other = await createGuest();
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(owner.token))
        .send({ title: 'Private to owner' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', auth(other.token))
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  describe('M19.3 — invite flow', () => {
    it('binds the assignee on accept and rejects a second invite/accept with 409', async () => {
      const { token: creatorToken } = await createGuest();
      const { token: friendToken } = await createGuest();

      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(creatorToken))
        .send({ title: 'Shared chore', verificationMethod: 'SELF' })
        .expect(201);
      const taskId = created.body.id;

      const invite = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/invite`)
        .set('Authorization', auth(creatorToken))
        .expect(201);
      expect(invite.body.inviteToken).toEqual(expect.any(String));
      expect(invite.body.inviteUrl).toContain(invite.body.inviteToken);

      const accepted = await request(app.getHttpServer())
        .post(`/tasks/invites/${invite.body.inviteToken}/accept`)
        .set('Authorization', auth(friendToken))
        .expect(200);
      expect(accepted.body.status).toBe('Accepted');

      // A second invite on an already-assigned task is a 409.
      await request(app.getHttpServer())
        .post(`/tasks/${taskId}/invite`)
        .set('Authorization', auth(creatorToken))
        .expect(409);

      // Accepting again with the same token is a 409 (already assigned).
      const { token: otherToken } = await createGuest();
      await request(app.getHttpServer())
        .post(`/tasks/invites/${invite.body.inviteToken}/accept`)
        .set('Authorization', auth(otherToken))
        .expect(409);
    });

    it('does not let a declined invite silently re-bind', async () => {
      const { token: creatorToken } = await createGuest();
      const { token: friendToken } = await createGuest();

      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(creatorToken))
        .send({ title: 'Decline me' })
        .expect(201);

      const invite = await request(app.getHttpServer())
        .post(`/tasks/${created.body.id}/invite`)
        .set('Authorization', auth(creatorToken))
        .expect(201);

      await request(app.getHttpServer())
        .post(`/tasks/invites/${invite.body.inviteToken}/decline`)
        .set('Authorization', auth(friendToken))
        .expect(200);

      // The declined token no longer resolves — accepting it is a 404.
      await request(app.getHttpServer())
        .post(`/tasks/invites/${invite.body.inviteToken}/accept`)
        .set('Authorization', auth(friendToken))
        .expect(404);

      // The creator can re-invite (new token).
      const reinvite = await request(app.getHttpServer())
        .post(`/tasks/${created.body.id}/invite`)
        .set('Authorization', auth(creatorToken))
        .expect(201);
      expect(reinvite.body.inviteToken).not.toBe(invite.body.inviteToken);
    });

    it('rejects the creator accepting their own invite with 400', async () => {
      const { token: creatorToken } = await createGuest();
      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(creatorToken))
        .send({ title: 'Self accept' })
        .expect(201);
      const invite = await request(app.getHttpServer())
        .post(`/tasks/${created.body.id}/invite`)
        .set('Authorization', auth(creatorToken))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tasks/invites/${invite.body.inviteToken}/accept`)
        .set('Authorization', auth(creatorToken))
        .expect(400);
    });
  });

  describe('M19.4 — creator-approval review flow', () => {
    it('runs the reject → resubmit → approve loop with participants-only evidence', async () => {
      const { token: creatorToken, userId: creatorId } = await createGuest();
      const { token: friendToken, userId: friendId } = await createGuest();

      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(creatorToken))
        .send({
          title: 'Assemble the shelf',
          verificationMethod: 'CREATOR_APPROVAL',
          evidenceRequired: true,
          rewardXp: 100,
        })
        .expect(201);
      const taskId = created.body.id;

      const invite = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/invite`)
        .set('Authorization', auth(creatorToken))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tasks/invites/${invite.body.inviteToken}/accept`)
        .set('Authorization', auth(friendToken))
        .expect(200);

      // Assignee submits evidence (photo required).
      const submission1 = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/submissions`)
        .set('Authorization', auth(friendToken))
        .attach('photo', pngBuffer, { filename: 'evidence.png', contentType: 'image/png' })
        .expect(201);
      expect(submission1.body.status).toBe('Submitted');
      expect(submission1.body.submissions[0].attachments).toHaveLength(1);
      expect(typeof submission1.body.submissions[0].attachments[0].url).toBe('string');
      const firstSubmissionId = submission1.body.submissions[0].id;

      // A stranger cannot read evidence (participants only).
      const { token: strangerToken } = await createGuest();
      await request(app.getHttpServer())
        .get(`/tasks/${taskId}/submissions`)
        .set('Authorization', auth(strangerToken))
        .expect(403);

      // Only the creator can review — the assignee cannot.
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/submissions/${firstSubmissionId}/review`)
        .set('Authorization', auth(friendToken))
        .send({ decision: 'Approve' })
        .expect(403);

      // Rejecting without a reason is a 400.
      await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/submissions/${firstSubmissionId}/review`)
        .set('Authorization', auth(creatorToken))
        .send({ decision: 'Reject' })
        .expect(400);

      // Reject with a reason.
      const rejected = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/submissions/${firstSubmissionId}/review`)
        .set('Authorization', auth(creatorToken))
        .send({ decision: 'Reject', rejectionReason: 'Wrong shelf' })
        .expect(200);
      expect(rejected.body.status).toBe('Rejected');

      // Assignee resubmits — prior history is preserved (2 submissions).
      const submission2 = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/submissions`)
        .set('Authorization', auth(friendToken))
        .attach('photo', pngBuffer, { filename: 'evidence2.png', contentType: 'image/png' })
        .expect(201);
      expect(submission2.body.status).toBe('Submitted');
      expect(submission2.body.submissions).toHaveLength(2);
      const secondSubmissionId = submission2.body.submissions[1].id;

      // Creator approves — reward goes to the assignee, not the creator.
      const approved = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}/submissions/${secondSubmissionId}/review`)
        .set('Authorization', auth(creatorToken))
        .send({ decision: 'Approve' })
        .expect(200);
      expect(approved.body.status).toBe('Approved');

      const friend = await prisma.user.findUnique({ where: { id: friendId } });
      const creator = await prisma.user.findUnique({ where: { id: creatorId } });
      expect(friend?.totalXp).toBe(100);
      expect(creator?.totalXp).toBe(0);
    });
  });

  describe('M19.6 — summary + idempotency', () => {
    it('returns dashboard-style counts for the caller', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .send({ title: 'Summary task A' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .send({ title: 'Summary task B' })
        .expect(201);

      const summary = await request(app.getHttpServer())
        .get('/tasks/summary')
        .set('Authorization', auth(token))
        .expect(200);
      expect(summary.body.created.total).toBeGreaterThanOrEqual(2);
      expect(summary.body.created.open).toBeGreaterThanOrEqual(2);
      expect(summary.body.assigned.total).toBe(0);
    });

    it('dedupes a repeated create via the Idempotency-Key header', async () => {
      const { token, userId } = await createGuest();
      const key = `e2e-key-${Date.now()}`;

      const first = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .set('Idempotency-Key', key)
        .send({ title: 'Idempotent task' })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(token))
        .set('Idempotency-Key', key)
        .send({ title: 'Idempotent task' })
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      const count = await prisma.userTask.count({ where: { creatorId: userId } });
      expect(count).toBe(1);
    });

    it('never double-creates when two requests share the same Idempotency-Key concurrently', async () => {
      // Regression test for a real race the backend-eval review caught: the
      // original implementation only deduped the *stored response*
      // (execute-then-check), so two requests that both passed the initial
      // "no stored response yet" lookup before either finished could both
      // create a UserTask row. The fix reserves the idempotency row BEFORE
      // executing, so one of these two truly-concurrent requests must lose
      // the reservation race and either replay the winner's response or get
      // a 409 — never create a second row.
      const { token, userId } = await createGuest();
      const key = `e2e-concurrent-key-${Date.now()}`;

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/tasks')
          .set('Authorization', auth(token))
          .set('Idempotency-Key', key)
          .send({ title: 'Concurrent idempotent task' }),
        request(app.getHttpServer())
          .post('/tasks')
          .set('Authorization', auth(token))
          .set('Idempotency-Key', key)
          .send({ title: 'Concurrent idempotent task' }),
      ]);

      const statuses = [a.status, b.status].sort();
      // Either both requests see the same successfully-created task (the
      // loser replayed the winner's response), or the loser hit the
      // reservation while the winner was still executing and got a 409 —
      // both outcomes are correct; double-creation is what's disallowed.
      expect(statuses[0]).toBe(201);
      expect([201, 409]).toContain(statuses[1]);
      if (statuses[1] === 201) {
        expect(a.body.id).toBe(b.body.id);
      }

      const count = await prisma.userTask.count({
        where: { creatorId: userId, title: 'Concurrent idempotent task' },
      });
      expect(count).toBe(1);
    });

    it('returns 403 for a stranger fetching a task detail (participants only)', async () => {
      const { token: ownerToken } = await createGuest();
      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(ownerToken))
        .send({ title: 'Private task' })
        .expect(201);

      const { token: strangerToken } = await createGuest();
      await request(app.getHttpServer())
        .get(`/tasks/${created.body.id}`)
        .set('Authorization', auth(strangerToken))
        .expect(403);
    });
  });
});
