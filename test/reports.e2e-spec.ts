import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (via docker-compose). Exercises the
 * user-facing reporting flow (P0 gap #6): a report hides the target for the
 * reporter only, and a second distinct reporter escalates to a global hide.
 * TODO(test-infra): move to a dedicated throwaway test DB once one exists — see
 * backend/CLAUDE.md.
 */
describe('Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const missionTitle = `E2E Report Mission ${stamp}`;
  let missionId: string;
  let completionId: string;
  const createdUserIds: string[] = [];

  async function createGuest(): Promise<{ token: string; userId: string }> {
    const res = await request(app.getHttpServer()).post('/auth/guest').expect(201);
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken, userId: res.body.user.id };
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

    const mission = await prisma.mission.create({
      data: {
        title: missionTitle,
        category: 'discover',
        description: 'Short teaser.',
        fullBrief: 'The full brief.',
        proofRequirement: 'A photo.',
        estimatedMinutes: 15,
        xpReward: 40,
        difficulty: 'Easy',
        difficultyDots: 1,
        crewTags: ['Solo'],
        settingTags: ['Indoors'],
        costTier: 0,
        isActive: true,
      },
    });
    missionId = mission.id;

    // A completion owned by a throwaway user — the target that reporters report.
    const owner = await prisma.user.create({ data: { isGuest: true } });
    createdUserIds.push(owner.id);
    const completion = await prisma.completion.create({
      data: {
        userId: owner.id,
        missionId,
        proofType: 'text',
        proofText: 'reportable proof',
        xpAwarded: 40,
      },
    });
    completionId = completion.id;
  });

  afterAll(async () => {
    await prisma.globalContentHide.deleteMany({ where: { targetId: completionId } });
    await prisma.hiddenContent.deleteMany({ where: { targetId: completionId } });
    await prisma.report.deleteMany({ where: { targetId: completionId } });
    await prisma.completion.deleteMany({ where: { missionId } });
    if (createdUserIds.length > 0) {
      await prisma.hiddenContent.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.report.deleteMany({ where: { reporterUserId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.mission.deleteMany({ where: { id: missionId } });
    await app.close();
  });

  describe('POST /reports', () => {
    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer())
        .post('/reports')
        .send({ targetType: 'Completion', targetId: completionId, reason: 'spam' })
        .expect(401);
    });

    it('rejects an unknown targetType with 400', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetType: 'Mission', targetId: completionId, reason: 'not allowed' })
        .expect(400);
    });

    it('404s when the target does not exist', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({
          targetType: 'Completion',
          targetId: '00000000-0000-0000-0000-000000000000',
          reason: 'ghost',
        })
        .expect(404);
    });

    it('rejects reporting your own account with 400', async () => {
      const { token, userId } = await createGuest();
      await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetType: 'User', targetId: userId, reason: 'self' })
        .expect(400);
    });

    it('first report hides the target for the reporter only (no global hide) and persists a Report + HiddenContent', async () => {
      const { token, userId } = await createGuest();

      const res = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetType: 'Completion', targetId: completionId, reason: 'Inappropriate photo' })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'Open',
        targetType: 'Completion',
        targetId: completionId,
        hiddenForReporter: true,
        globallyHidden: false,
      });
      expect(res.body.reportId).toEqual(expect.any(String));

      const hidden = await prisma.hiddenContent.findUnique({
        where: {
          userId_targetType_targetId: {
            userId,
            targetType: 'Completion',
            targetId: completionId,
          },
        },
      });
      expect(hidden).not.toBeNull();

      // Not globally hidden after a single distinct reporter.
      const global = await prisma.globalContentHide.findUnique({
        where: { targetType_targetId: { targetType: 'Completion', targetId: completionId } },
      });
      expect(global).toBeNull();
    });

    it('is idempotent per reporter: reporting the same target twice reuses one Report and never escalates alone', async () => {
      // Own target, isolated from the shared `completionId` (which already has a
      // reporter from the test above) — otherwise this user would be the SECOND
      // distinct reporter on their very first call, escalating immediately and
      // making the "never escalates alone" assertion meaningless.
      const owner = await prisma.user.create({ data: { isGuest: true } });
      createdUserIds.push(owner.id);
      const ownCompletion = await prisma.completion.create({
        data: {
          userId: owner.id,
          missionId,
          proofType: 'text',
          proofText: 'idempotency-test proof',
          xpAwarded: 40,
        },
      });

      const { token, userId } = await createGuest();

      const first = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetType: 'Completion', targetId: ownCompletion.id, reason: 'first' })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetType: 'Completion', targetId: ownCompletion.id, reason: 'again' })
        .expect(201);

      expect(second.body.reportId).toBe(first.body.reportId);
      expect(second.body.globallyHidden).toBe(false);

      const reportCount = await prisma.report.count({
        where: { reporterUserId: userId, targetType: 'Completion', targetId: ownCompletion.id },
      });
      expect(reportCount).toBe(1);
    });

    it('escalates to a global hide once a SECOND distinct user reports the same target', async () => {
      // Two fresh, independent reporters targeting the same completion.
      const reporterA = await createGuest();
      const reporterB = await createGuest();

      const a = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${reporterA.token}`)
        .send({ targetType: 'Completion', targetId: completionId, reason: 'abuse A' })
        .expect(201);
      // First distinct reporter of this pair may already be preceded by earlier
      // tests' reporters, so assert only that a second distinct reporter results
      // in a global hide — the escalation is monotonic.
      expect(a.body.hiddenForReporter).toBe(true);

      const b = await request(app.getHttpServer())
        .post('/reports')
        .set('Authorization', `Bearer ${reporterB.token}`)
        .send({ targetType: 'Completion', targetId: completionId, reason: 'abuse B' })
        .expect(201);

      expect(b.body.globallyHidden).toBe(true);

      const global = await prisma.globalContentHide.findUnique({
        where: { targetType_targetId: { targetType: 'Completion', targetId: completionId } },
      });
      expect(global).not.toBeNull();
    });
  });
});
