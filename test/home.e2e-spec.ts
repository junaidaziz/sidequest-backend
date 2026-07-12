import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { MissionPoolService } from './../src/missions/mission-pool.service';

/**
 * Runs against the local dev database (via docker-compose). Seeds two missions
 * the guest saves, then asserts the aggregated /home payload. TODO(test-infra):
 * move to a dedicated throwaway test database once one exists — see
 * backend/CLAUDE.md.
 *
 * The daily mission is asserted only structurally (it is drawn from the whole
 * active pool, which the shared seed also populates, so its exact id is not
 * pinned here) — determinism is proven in the daily-mission.util unit test.
 */
describe('Home (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let missionPool: MissionPoolService;

  const stamp = Date.now();
  const titleA = `E2E Home Save A ${stamp}`;
  const titleB = `E2E Home Save B ${stamp}`;
  const seededTitles = [titleA, titleB];
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
    missionPool = app.get(MissionPoolService);
    await app.init();

    const base = {
      category: 'discover' as const,
      description: 'Short teaser.',
      fullBrief: 'The full brief.',
      proofRequirement: 'A photo.',
      estimatedMinutes: 15,
      xpReward: 25,
      difficulty: 'Easy' as const,
      difficultyDots: 1,
      costTier: 0,
      isActive: true,
    };
    await prisma.mission.create({
      data: { ...base, title: titleA, crewTags: ['Solo'], settingTags: ['Outdoors'] },
    });
    await prisma.mission.create({
      data: { ...base, title: titleB, crewTags: ['Solo'], settingTags: ['Outdoors'] },
    });
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

  describe('GET /home', () => {
    it('returns 401 without an access token', async () => {
      await request(app.getHttpServer()).get('/home').expect(401);
    });

    it('returns the aggregated shape for a fresh guest with no saves', async () => {
      const { token } = await createGuest();

      const res = await request(app.getHttpServer())
        .get('/home')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Fresh guest: 0 XP -> level 1, no streak, no saved packs.
      expect(res.body.level).toEqual({
        level: 1,
        xpIntoLevel: 0,
        xpToNextLevel: 100,
        totalXp: 0,
      });
      expect(res.body.streak).toEqual({ currentStreak: 0, longestStreak: 0 });
      expect(res.body.pendingChallenges).toEqual([]);
      expect(res.body.savedPacks).toEqual([]);
      // Daily mission is either null (empty pool) or a mapped mission object.
      if (res.body.dailyMission !== null) {
        expect(res.body.dailyMission).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            title: expect.any(String),
            desc: expect.any(String),
            time: expect.stringMatching(/ min$/),
            xp: expect.stringMatching(/^\+.* XP$/),
          }),
        );
      }
    });

    it('is deterministic within a request: two calls in the same day return the same daily mission', async () => {
      const { token } = await createGuest();

      const first = await request(app.getHttpServer())
        .get('/home')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const second = await request(app.getHttpServer())
        .get('/home')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(second.body.dailyMission).toEqual(first.body.dailyMission);
    });

    it('groups saved missions into packs by shared tags', async () => {
      const { token } = await createGuest();

      for (const title of seededTitles) {
        const mission = await prisma.mission.findUnique({ where: { title } });
        await request(app.getHttpServer())
          .post(`/missions/${mission?.id}/save`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .get('/home')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Both seeded missions share Outdoors|Solo, so they collapse into one pack.
      expect(res.body.savedPacks).toContainEqual({
        name: 'Outdoors Solo pack',
        missionCount: 2,
      });
    });
  });
});
