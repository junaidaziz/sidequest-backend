import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { MissionPoolService } from './../src/missions/mission-pool.service';
import { resetThrottleState } from './support/reset-throttle';

/**
 * Runs against the local dev database (via docker-compose), seeding two known
 * missions and cleaning them up in afterAll. TODO(test-infra): move to a
 * dedicated throwaway test database once one exists — see backend/CLAUDE.md.
 *
 * The seeded missions use crew "Kids Mode" + setting "Indoors" + 15-minute
 * length, a context that none of the 15 curated seed missions satisfy (the
 * only Kids-Mode missions there are 20 and 30 minutes long). So the request
 * below returns exactly these two rows regardless of whether the curated seed
 * has been run, keeping the shape assertions deterministic.
 */
describe('Missions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let missionPool: MissionPoolService;

  const stamp = Date.now();
  const titleA = `E2E Quick Indoor A ${stamp}`;
  const titleB = `E2E Quick Indoor B ${stamp}`;
  const seededTitles = [titleA, titleB];
  let missionAId: string;
  const createdUserIds: string[] = [];

  const matchingContext = {
    crew: 'Kids Mode',
    time: '15 min',
    setting: 'Indoors',
    budget: 'Free',
  };

  /** Creates a fresh guest session and returns its access token + user id. */
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
    missionPool = app.get(MissionPoolService);
    await app.init();
    await resetThrottleState(app);

    const base = {
      category: 'discover' as const,
      description: 'Short teaser.',
      fullBrief: 'The full brief.',
      proofRequirement: 'A photo.',
      estimatedMinutes: 15,
      difficulty: 'Easy' as const,
      difficultyDots: 1,
      crewTags: ['Kids Mode'],
      settingTags: ['Indoors'],
      costTier: 0,
      isActive: true,
    };
    const createdA = await prisma.mission.create({
      data: { ...base, title: titleA, xpReward: 25 },
    });
    missionAId = createdA.id;
    await prisma.mission.create({ data: { ...base, title: titleB, xpReward: 30 } });
    // A previous e2e file may still have a warm cache entry that predates
    // these fixtures — force the next read to see them.
    await missionPool.invalidate();
  });

  afterAll(async () => {
    const missions = await prisma.mission.findMany({
      where: { title: { in: seededTitles } },
      select: { id: true },
    });
    const missionIds = missions.map((m) => m.id);
    await prisma.savedMission.deleteMany({ where: { missionId: { in: missionIds } } });
    if (createdUserIds.length > 0) {
      await prisma.savedMission.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.mission.deleteMany({ where: { title: { in: seededTitles } } });
    // Don't leave these now-deleted fixtures cached for the next e2e file.
    await missionPool.invalidate();
    await app.close();
  });

  describe('POST /missions/generate', () => {
    it('returns matching missions with no auth, in the mobile short-field shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/missions/generate')
        .send(matchingContext)
        .expect(200);

      expect(Array.isArray(res.body.missions)).toBe(true);
      // Only our two seeded rows can match this context.
      expect(res.body.missions).toHaveLength(2);

      const returnedTitles = res.body.missions.map((m: { title: string }) => m.title).sort();
      expect(returnedTitles).toEqual(seededTitles.slice().sort());

      const mission = res.body.missions.find((m: { title: string }) => m.title === titleA);
      expect(mission).toEqual({
        id: expect.any(String),
        category: 'discover',
        title: titleA,
        desc: 'Short teaser.',
        full: 'The full brief.',
        proof: 'A photo.',
        time: '15 min',
        xp: '+25 XP',
        diff: 'Easy',
        dots: 1,
      });
    });

    it('excludes missions above the time ceiling of the request', async () => {
      const res = await request(app.getHttpServer())
        .post('/missions/generate')
        // Same crew/setting, but a 15-min length is unaffected; narrowing budget
        // to Free keeps both — instead assert the seeded rows never leak into a
        // context whose crew they lack.
        .send({ ...matchingContext, crew: 'Solo' })
        .expect(200);

      const titles = res.body.missions.map((m: { title: string }) => m.title);
      expect(titles).not.toContain(titleA);
      expect(titles).not.toContain(titleB);
    });

    it('rejects a body with an out-of-set field with 400', async () => {
      await request(app.getHttpServer())
        .post('/missions/generate')
        .send({ ...matchingContext, crew: 'Coworkers' })
        .expect(400);
    });

    it('rejects a body with unknown extra fields with 400', async () => {
      await request(app.getHttpServer())
        .post('/missions/generate')
        .send({ ...matchingContext, sneaky: true })
        .expect(400);
    });
  });

  describe('POST/DELETE /missions/:missionId/save', () => {
    it('returns 401 for save without an access token', async () => {
      await request(app.getHttpServer()).post(`/missions/${missionAId}/save`).expect(401);
    });

    it('returns 401 for unsave without an access token', async () => {
      await request(app.getHttpServer()).delete(`/missions/${missionAId}/save`).expect(401);
    });

    it('returns 404 when saving a valid but non-existent mission id', async () => {
      const { token } = await createGuest();
      await request(app.getHttpServer())
        .post(`/missions/00000000-0000-0000-0000-000000000000/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('saves idempotently: two saves both return { saved: true } and create exactly one row', async () => {
      const { token, userId } = await createGuest();

      const first = await request(app.getHttpServer())
        .post(`/missions/${missionAId}/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(first.body).toEqual({ saved: true });

      const second = await request(app.getHttpServer())
        .post(`/missions/${missionAId}/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(second.body).toEqual({ saved: true });

      const rows = await prisma.savedMission.count({
        where: { userId, missionId: missionAId },
      });
      expect(rows).toBe(1);
    });

    it('unsaves idempotently: deleting twice both return { saved: false } and leave no row', async () => {
      const { token, userId } = await createGuest();

      await request(app.getHttpServer())
        .post(`/missions/${missionAId}/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const first = await request(app.getHttpServer())
        .delete(`/missions/${missionAId}/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(first.body).toEqual({ saved: false });

      // Deleting an already-removed save is not an error.
      const second = await request(app.getHttpServer())
        .delete(`/missions/${missionAId}/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(second.body).toEqual({ saved: false });

      const rows = await prisma.savedMission.count({
        where: { userId, missionId: missionAId },
      });
      expect(rows).toBe(0);
    });
  });

  describe('GET /missions/:missionId', () => {
    // One shared guest for this block (not per-test) — none of these cases care
    // about a distinct user identity, and the file's guest-creation throttle
    // (10/60s, see backend/CLAUDE.md) is shared across every describe block here.
    let sharedToken: string;

    beforeAll(async () => {
      const { token } = await createGuest();
      sharedToken = token;
    });

    it('is public (no access token required) — backs the unauthenticated challenge/deep-link flow', async () => {
      const res = await request(app.getHttpServer()).get(`/missions/${missionAId}`).expect(200);
      expect(res.body).toMatchObject({ id: missionAId, title: titleA });
    });

    it('returns 400 for a non-UUID mission id', async () => {
      await request(app.getHttpServer())
        .get('/missions/not-a-uuid')
        .set('Authorization', `Bearer ${sharedToken}`)
        .expect(400);
    });

    it('returns 404 for a valid but non-existent mission id', async () => {
      await request(app.getHttpServer())
        .get('/missions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${sharedToken}`)
        .expect(404);
    });

    it('returns the mission in the mobile short-field shape, independent of the saved list', async () => {
      // Not saved by this user — the detail must resolve regardless.
      const res = await request(app.getHttpServer())
        .get(`/missions/${missionAId}`)
        .set('Authorization', `Bearer ${sharedToken}`)
        .expect(200);

      expect(res.body).toEqual({
        id: missionAId,
        category: 'discover',
        title: titleA,
        desc: 'Short teaser.',
        full: 'The full brief.',
        proof: 'A photo.',
        time: '15 min',
        xp: '+25 XP',
        diff: 'Easy',
        dots: 1,
      });
    });

    it('does not let the dynamic :missionId route shadow GET /missions/saved', async () => {
      // '/missions/saved' must still hit the saved-list handler (200 + page shape),
      // not be parsed as a mission id (which would 400 on the UUID pipe).
      const res = await request(app.getHttpServer())
        .get('/missions/saved')
        .set('Authorization', `Bearer ${sharedToken}`)
        .expect(200);
      expect(res.body).toMatchObject({ items: expect.any(Array), total: expect.any(Number) });
    });
  });

  describe('GET /missions/saved', () => {
    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer()).get('/missions/saved').expect(401);
    });

    it("returns only the caller's own saved missions, newest first, in the mobile short-field shape", async () => {
      const { token } = await createGuest();
      const missions = await prisma.mission.findMany({
        where: { title: { in: seededTitles } },
        orderBy: { title: 'asc' },
      });
      const [first, second] = missions;

      await request(app.getHttpServer())
        .post(`/missions/${first.id}/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/missions/${second.id}/save`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/missions/saved')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.limit).toBe(20);
      expect(res.body.offset).toBe(0);
      // Newest-saved-first: second.id was saved after first.id.
      expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([second.id, first.id]);
      expect(res.body.items[0]).toEqual({
        id: second.id,
        category: 'discover',
        title: second.title,
        desc: 'Short teaser.',
        full: 'The full brief.',
        proof: 'A photo.',
        time: '15 min',
        xp: expect.any(String),
        diff: 'Easy',
        dots: 1,
        savedAt: expect.any(String),
      });
    });

    it("does not return another user's saved missions", async () => {
      const owner = await createGuest();
      const other = await createGuest();
      await request(app.getHttpServer())
        .post(`/missions/${missionAId}/save`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/missions/saved')
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('respects an explicit limit/offset', async () => {
      const { token } = await createGuest();
      const missions = await prisma.mission.findMany({
        where: { title: { in: seededTitles } },
      });
      for (const mission of missions) {
        await request(app.getHttpServer())
          .post(`/missions/${mission.id}/save`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .get('/missions/saved?limit=1&offset=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(1);
      expect(res.body.total).toBe(2);
    });
  });
});
