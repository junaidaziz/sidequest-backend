import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (docker-compose). Requires the M20
 * referrals migration to be applied first (npx prisma migrate deploy) and the
 * on_referee_first_completion reward rule to be seeded (npm run prisma:seed).
 * TODO(test-infra): move to a throwaway test DB once one exists — see
 * backend/CLAUDE.md.
 */
describe('Referrals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdUserIds: string[] = [];

  async function createGuest(): Promise<{ token: string; userId: string }> {
    const res = await request(app.getHttpServer()).post('/auth/guest').expect(201);
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken, userId: res.body.user.id };
  }

  const auth = (token: string): string => `Bearer ${token}`;
  const unique = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      await prisma.referralReward.deleteMany({ where: { userId: { in: ids } } });
      await prisma.referral.deleteMany({
        where: { OR: [{ referrerId: { in: ids } }, { refereeId: { in: ids } }] },
      });
      await prisma.referralCode.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userTaskEvent.deleteMany({ where: { task: { creatorId: { in: ids } } } });
      await prisma.userTaskSubmission.deleteMany({ where: { task: { creatorId: { in: ids } } } });
      await prisma.userTask.deleteMany({
        where: { OR: [{ creatorId: { in: ids } }, { assigneeId: { in: ids } }] },
      });
      await prisma.idempotencyKey.deleteMany({ where: { userId: { in: ids } } });
      // M21's notification hooks fire on referral registration/reward events,
      // so these tests now create Notification rows as a side effect —
      // clear them before deleting the user or the FK constraint fails.
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app.close();
  });

  describe('M20.1/M20.2 — GET /referrals/me', () => {
    it('mints a code on first call and returns stats', async () => {
      const { token } = await createGuest();

      const res = await request(app.getHttpServer())
        .get('/referrals/me')
        .set('Authorization', auth(token))
        .expect(200);

      expect(res.body.code).toEqual(expect.any(String));
      expect(res.body.code).toHaveLength(8);
      expect(res.body.inviteUrl).toContain(res.body.code);
      expect(res.body).toMatchObject({
        totalReferrals: 0,
        completedReferrals: 0,
        pendingReferrals: 0,
        invitesSent: 0,
        rewardsEarnedXp: 0,
      });
    });

    it('two concurrent first-ever calls converge on a single code (TOCTOU)', async () => {
      const { token, userId } = await createGuest();

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).get('/referrals/me').set('Authorization', auth(token)),
        request(app.getHttpServer()).get('/referrals/me').set('Authorization', auth(token)),
      ]);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.code).toBe(b.body.code);
      const rows = await prisma.referralCode.count({ where: { userId } });
      expect(rows).toBe(1);
    });
  });

  describe('M20.2 — POST /referrals/invites', () => {
    it('records a share event and rejects an unknown channel', async () => {
      const { token } = await createGuest();

      await request(app.getHttpServer())
        .post('/referrals/invites')
        .set('Authorization', auth(token))
        .send({ channel: 'whatsapp' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({ success: true, channel: 'whatsapp' });
          expect(res.body.totalInvitesSent).toBeGreaterThanOrEqual(1);
        });

      await request(app.getHttpServer())
        .post('/referrals/invites')
        .set('Authorization', auth(token))
        .send({ channel: 'carrier_pigeon' })
        .expect(400);
    });

    it('dedupes a repeated invite via the Idempotency-Key header', async () => {
      const { token, userId } = await createGuest();
      const key = `e2e-invite-${unique()}`;

      const first = await request(app.getHttpServer())
        .post('/referrals/invites')
        .set('Authorization', auth(token))
        .set('Idempotency-Key', key)
        .send({ channel: 'telegram' })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/referrals/invites')
        .set('Authorization', auth(token))
        .set('Idempotency-Key', key)
        .send({ channel: 'telegram' })
        .expect(201);

      expect(second.body.totalInvitesSent).toBe(first.body.totalInvitesSent);
      const rows = await prisma.referral.count({ where: { referrerId: userId, refereeId: null } });
      expect(rows).toBe(1);
    });
  });

  describe('M20.3 — signup attribution', () => {
    it('attributes a valid referral code through the guest-upgrade-in-place path', async () => {
      const referrer = await createGuest();
      const me = await request(app.getHttpServer())
        .get('/referrals/me')
        .set('Authorization', auth(referrer.token))
        .expect(200);
      const code = me.body.code as string;

      const referee = await createGuest();
      const email = `referee-${unique()}@example.com`;
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .set('Authorization', auth(referee.token))
        .send({ email, password: 'password123', referralCode: code })
        .expect(201);
      // Upgraded in place — same row.
      expect(signup.body.user.id).toBe(referee.userId);

      const referral = await prisma.referral.findFirst({
        where: { referrerId: referrer.userId, refereeId: referee.userId },
      });
      expect(referral).not.toBeNull();
      expect(referral?.status).toBe('Pending');
    });

    it('rejects an invalid referral code with a 400 and does not upgrade the account', async () => {
      const referee = await createGuest();
      const email = `bad-${unique()}@example.com`;

      await request(app.getHttpServer())
        .post('/auth/signup')
        .set('Authorization', auth(referee.token))
        .send({ email, password: 'password123', referralCode: 'ZZZZZZZZ' })
        .expect(400);

      const stillGuest = await prisma.user.findUnique({ where: { id: referee.userId } });
      expect(stillGuest?.isGuest).toBe(true);
      expect(stillGuest?.email).toBeNull();
    });
  });

  describe('reward on referee first completion (Decisions 3 & 4)', () => {
    it('grants the referrer XP exactly once when the referee first completes', async () => {
      const referrer = await createGuest();
      const me = await request(app.getHttpServer())
        .get('/referrals/me')
        .set('Authorization', auth(referrer.token))
        .expect(200);
      const code = me.body.code as string;

      const referee = await createGuest();
      const email = `converts-${unique()}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/signup')
        .set('Authorization', auth(referee.token))
        .send({ email, password: 'password123', referralCode: code })
        .expect(201);

      // The referee logs in fresh, then completes their first task (auto-resolved).
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      const refereeToken = login.body.accessToken as string;

      const task = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(refereeToken))
        .send({ title: 'First quest' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tasks/${task.body.id}/submissions`)
        .set('Authorization', auth(refereeToken))
        .field('notes', 'done')
        .expect(201);

      const referrerAfter = await prisma.user.findUnique({ where: { id: referrer.userId } });
      expect(referrerAfter?.totalXp).toBe(50);

      const referral = await prisma.referral.findFirst({
        where: { referrerId: referrer.userId, refereeId: referee.userId },
        include: { reward: true },
      });
      expect(referral?.status).toBe('Completed');
      expect(referral?.reward?.amount).toBe(50);

      // A second completion must not grant again.
      const task2 = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', auth(refereeToken))
        .send({ title: 'Second quest' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/tasks/${task2.body.id}/submissions`)
        .set('Authorization', auth(refereeToken))
        .field('notes', 'done again')
        .expect(201);

      const referrerFinal = await prisma.user.findUnique({ where: { id: referrer.userId } });
      expect(referrerFinal?.totalXp).toBe(50);
    });
  });

  describe('unauthorized', () => {
    it('rejects an unauthenticated GET /referrals/me with 401', async () => {
      await request(app.getHttpServer()).get('/referrals/me').expect(401);
    });
  });
});
