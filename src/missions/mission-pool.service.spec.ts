import { Test, TestingModule } from '@nestjs/testing';
import { Mission, MissionCategory, MissionDifficulty, MissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MissionPoolService } from './mission-pool.service';

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-id',
    title: 'Test Mission',
    category: MissionCategory.explore,
    description: 'Short teaser.',
    fullBrief: 'The full brief.',
    proofRequirement: 'A photo.',
    estimatedMinutes: 10,
    xpReward: 40,
    difficulty: MissionDifficulty.Easy,
    difficultyDots: 1,
    crewTags: ['Solo'],
    settingTags: ['Outdoors'],
    costTier: 0,
    isActive: true,
    status: MissionStatus.Published,
    approvedAt: null,
    approvedByAdminId: null,
    featured: false,
    sponsorName: null,
    startDate: null,
    endDate: null,
    participantLimit: null,
    milestones: null,
    safetyNotice: null,
    iconKey: null,
    createdByAdminId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('MissionPoolService', () => {
  let findMany: jest.Mock;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;
  let redisDel: jest.Mock;
  const ORIGINAL_ENV = process.env;

  async function buildService(): Promise<MissionPoolService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionPoolService,
        { provide: PrismaService, useValue: { mission: { findMany } } },
        { provide: RedisService, useValue: { get: redisGet, set: redisSet, del: redisDel } },
      ],
    }).compile();
    return module.get(MissionPoolService);
  }

  beforeEach(() => {
    findMany = jest.fn();
    redisGet = jest.fn();
    redisSet = jest.fn();
    redisDel = jest.fn();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MISSION_POOL_CACHE_TTL_SECONDS;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('queries active, non-deleted missions ordered by id on a cache miss', async () => {
    redisGet.mockResolvedValue(null);
    const pool = [makeMission()];
    findMany.mockResolvedValue(pool);
    const service = await buildService();

    const result = await service.getActivePool();

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
      orderBy: { id: 'asc' },
    });
    expect(result).toEqual(pool);
  });

  it('populates the cache after a miss, with the default 60s TTL', async () => {
    redisGet.mockResolvedValue(null);
    const pool = [makeMission()];
    findMany.mockResolvedValue(pool);
    const service = await buildService();

    await service.getActivePool();

    expect(redisSet).toHaveBeenCalledWith('missions:active-pool', JSON.stringify(pool), 'EX', 60);
  });

  it('honors a valid MISSION_POOL_CACHE_TTL_SECONDS override', async () => {
    process.env.MISSION_POOL_CACHE_TTL_SECONDS = '120';
    redisGet.mockResolvedValue(null);
    const pool = [makeMission()];
    findMany.mockResolvedValue(pool);
    const service = await buildService();

    await service.getActivePool();

    expect(redisSet).toHaveBeenCalledWith('missions:active-pool', JSON.stringify(pool), 'EX', 120);
  });

  it('throws at construction on a non-numeric TTL, instead of silently disabling the cache', async () => {
    process.env.MISSION_POOL_CACHE_TTL_SECONDS = 'sixty';
    await expect(buildService()).rejects.toThrow(/MISSION_POOL_CACHE_TTL_SECONDS/);
  });

  it('throws at construction on a zero/negative TTL', async () => {
    process.env.MISSION_POOL_CACHE_TTL_SECONDS = '0';
    await expect(buildService()).rejects.toThrow(/MISSION_POOL_CACHE_TTL_SECONDS/);
  });

  it('returns the cached pool with Date fields revived, without touching Postgres', async () => {
    const pool = [makeMission({ id: 'cached' })];
    redisGet.mockResolvedValue(JSON.stringify(pool));
    const service = await buildService();

    const result = await service.getActivePool();

    expect(result).toEqual(pool);
    expect(result[0].createdAt).toBeInstanceOf(Date);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('revives a non-null deletedAt from the cache as a Date', async () => {
    const pool = [makeMission({ id: 'cached', deletedAt: new Date('2026-02-01T00:00:00.000Z') })];
    redisGet.mockResolvedValue(JSON.stringify(pool));
    const service = await buildService();

    const result = await service.getActivePool();

    expect(result[0].deletedAt).toBeInstanceOf(Date);
    expect(result[0].deletedAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('falls back to Postgres when the cache read throws', async () => {
    redisGet.mockRejectedValue(new Error('connection refused'));
    const pool = [makeMission()];
    findMany.mockResolvedValue(pool);
    const service = await buildService();

    const result = await service.getActivePool();

    expect(result).toEqual(pool);
  });

  it('does not fail the request when the cache write throws', async () => {
    redisGet.mockResolvedValue(null);
    redisSet.mockRejectedValue(new Error('connection refused'));
    const pool = [makeMission()];
    findMany.mockResolvedValue(pool);
    const service = await buildService();

    await expect(service.getActivePool()).resolves.toEqual(pool);
  });

  describe('invalidate', () => {
    it('deletes the cache key', async () => {
      redisDel.mockResolvedValue(1);
      const service = await buildService();

      await service.invalidate();

      expect(redisDel).toHaveBeenCalledWith('missions:active-pool');
    });

    it('does not throw when the cache delete fails', async () => {
      redisDel.mockRejectedValue(new Error('connection refused'));
      const service = await buildService();

      await expect(service.invalidate()).resolves.toBeUndefined();
    });
  });
});
