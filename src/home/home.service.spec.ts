import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Mission, MissionCategory, MissionDifficulty, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MissionPoolService } from '../missions/mission-pool.service';
import { HomeService } from './home.service';

interface PrismaMock {
  user: { findUnique: jest.Mock };
  savedMission: { findMany: jest.Mock };
  completion: { groupBy: jest.Mock };
}

const USER_ID = '22222222-2222-2222-2222-222222222222';

/** Builds a Mission row; override per test. */
function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: overrides.id ?? 'mission-id',
    title: 'Test Mission',
    category: MissionCategory.explore,
    description: 'Short teaser.',
    fullBrief: 'The full brief.',
    proofRequirement: 'A photo.',
    estimatedMinutes: 20,
    xpReward: 40,
    difficulty: MissionDifficulty.Easy,
    difficultyDots: 1,
    crewTags: ['Solo'],
    settingTags: ['Outdoors'],
    costTier: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('HomeService', () => {
  let service: HomeService;
  let prisma: PrismaMock;
  let getActivePool: jest.Mock;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      savedMission: { findMany: jest.fn() },
      completion: { groupBy: jest.fn() },
    };
    getActivePool = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: PrismaService, useValue: prisma },
        { provide: MissionPoolService, useValue: { getActivePool } },
      ],
    }).compile();

    service = module.get(HomeService);
  });

  /** Wires the concurrent reads with the given fixtures. */
  function seed(opts: {
    user?: { totalXp: number; currentStreak: number; longestStreak: number } | null;
    missions?: Mission[];
    saved?: { mission: { settingTags: string[]; crewTags: string[] } }[];
    completionGroups?: { verificationStatus: VerificationStatus; _count: number }[];
  }) {
    prisma.user.findUnique.mockResolvedValue(
      opts.user === undefined ? { totalXp: 0, currentStreak: 0, longestStreak: 0 } : opts.user,
    );
    getActivePool.mockResolvedValue(opts.missions ?? []);
    prisma.savedMission.findMany.mockResolvedValue(opts.saved ?? []);
    prisma.completion.groupBy.mockResolvedValue(opts.completionGroups ?? []);
  }

  it('throws NotFoundException when the user row is missing (defensive)', async () => {
    seed({ user: null });
    await expect(service.getHome(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads the active mission pool from MissionPoolService (cached)', async () => {
    seed({});
    await service.getHome(USER_ID);
    expect(getActivePool).toHaveBeenCalledTimes(1);
  });

  it('scopes saved missions to the current user and selects only the grouping tags', async () => {
    seed({});
    await service.getHome(USER_ID);
    expect(prisma.savedMission.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { mission: { select: { settingTags: true, crewTags: true } } },
    });
  });

  it('derives level from totalXp and surfaces streak counters verbatim', async () => {
    seed({ user: { totalXp: 250, currentStreak: 4, longestStreak: 12 } });
    const res = await service.getHome(USER_ID);
    expect(res.level).toEqual({ level: 3, xpIntoLevel: 50, xpToNextLevel: 50, totalXp: 250 });
    expect(res.streak).toEqual({ currentStreak: 4, longestStreak: 12 });
  });

  it('always returns an empty pendingChallenges placeholder', async () => {
    seed({});
    const res = await service.getHome(USER_ID);
    expect(res.pendingChallenges).toEqual([]);
  });

  it('returns a null dailyMission when there are no active missions', async () => {
    seed({ missions: [] });
    const res = await service.getHome(USER_ID);
    expect(res.dailyMission).toBeNull();
  });

  it('returns the deterministic daily mission mapped to the mobile short-field shape', async () => {
    // Freeze the clock to 2026-07-12 (day-seed 20646). With a 4-mission pool
    // ordered by id, 20646 % 4 === 2 -> the third mission ('c').
    jest.useFakeTimers().setSystemTime(new Date('2026-07-12T09:00:00.000Z'));
    const missions = ['a', 'b', 'c', 'd'].map((id) =>
      makeMission({
        id,
        title: `Mission ${id}`,
        description: 'teaser',
        fullBrief: 'brief',
        proofRequirement: 'photo',
        estimatedMinutes: 30,
        xpReward: 55,
        difficulty: MissionDifficulty.Medium,
        difficultyDots: 2,
        category: MissionCategory.discover,
      }),
    );
    seed({ missions });

    const res = await service.getHome(USER_ID);

    expect(res.dailyMission).toEqual({
      id: 'c',
      category: 'discover',
      title: 'Mission c',
      desc: 'teaser',
      full: 'brief',
      proof: 'photo',
      time: '30 min',
      xp: '+55 XP',
      diff: 'Medium',
      dots: 2,
    });
    jest.useRealTimers();
  });

  it('groups the user saved missions into packs ordered by count descending', async () => {
    seed({
      saved: [
        { mission: { settingTags: ['Outdoors'], crewTags: ['Solo'] } },
        { mission: { settingTags: ['Indoors'], crewTags: ['Family'] } },
        { mission: { settingTags: ['Indoors'], crewTags: ['Family'] } },
      ],
    });
    const res = await service.getHome(USER_ID);
    expect(res.savedPacks).toEqual([
      { name: 'Indoors Family pack', missionCount: 2 },
      { name: 'Outdoors Solo pack', missionCount: 1 },
    ]);
  });

  it('returns an empty savedPacks array when the user has saved nothing', async () => {
    seed({ saved: [] });
    const res = await service.getHome(USER_ID);
    expect(res.savedPacks).toEqual([]);
  });

  it('groups completions by verificationStatus scoped to the user in a single query', async () => {
    seed({});
    await service.getHome(USER_ID);
    expect(prisma.completion.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.completion.groupBy).toHaveBeenCalledWith({
      by: ['verificationStatus'],
      where: { userId: USER_ID },
      _count: true,
    });
  });

  it('reports all-zero task stats and a 0 completionRate (not NaN) when there are no completions', async () => {
    seed({ completionGroups: [] });
    const res = await service.getHome(USER_ID);
    expect(res.taskStats).toEqual({
      total: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      completionRate: 0,
    });
    expect(Number.isNaN(res.taskStats.completionRate)).toBe(false);
  });

  it('reduces a mix of all three statuses into correct buckets and completion rate', async () => {
    seed({
      completionGroups: [
        { verificationStatus: VerificationStatus.Approved, _count: 6 },
        { verificationStatus: VerificationStatus.Pending, _count: 3 },
        { verificationStatus: VerificationStatus.Rejected, _count: 1 },
      ],
    });
    const res = await service.getHome(USER_ID);
    expect(res.taskStats).toEqual({
      total: 10,
      approved: 6,
      pending: 3,
      rejected: 1,
      completionRate: 0.6,
    });
  });

  it('reports a completionRate of 1 when every completion is approved', async () => {
    seed({
      completionGroups: [{ verificationStatus: VerificationStatus.Approved, _count: 4 }],
    });
    const res = await service.getHome(USER_ID);
    expect(res.taskStats).toEqual({
      total: 4,
      approved: 4,
      pending: 0,
      rejected: 0,
      completionRate: 1,
    });
  });
});
