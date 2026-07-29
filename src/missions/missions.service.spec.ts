import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Mission, MissionCategory, MissionDifficulty, MissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateMissionsDto } from './dto/generate-missions.dto';
import { MissionPoolService } from './mission-pool.service';
import { MissionsService } from './missions.service';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const MISSION_ID = '11111111-1111-1111-1111-111111111111';

/** Builds a Mission row with sensible, wide-matching defaults; override per test. */
function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: overrides.id ?? 'mission-id',
    title: 'Test Mission',
    category: MissionCategory.explore,
    description: 'Short teaser.',
    fullBrief: 'The full brief.',
    proofRequirement: 'A photo.',
    estimatedMinutes: 10,
    xpReward: 40,
    difficulty: MissionDifficulty.Easy,
    difficultyDots: 1,
    crewTags: ['Solo', 'Partner', 'Friends', 'Family', 'Kids Mode'],
    settingTags: ['Indoors', 'Outdoors', 'City', 'Nature'],
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
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

/** A request that matches every default mission from makeMission(). */
const BASE_DTO: GenerateMissionsDto = {
  crew: 'Solo',
  time: '2+ hours',
  setting: 'Indoors',
  budget: 'No limit',
};

describe('MissionsService', () => {
  let service: MissionsService;
  let getActivePool: jest.Mock;
  let findUnique: jest.Mock;
  let upsert: jest.Mock;
  let deleteMany: jest.Mock;
  let findMany: jest.Mock;
  let count: jest.Mock;

  beforeEach(async () => {
    getActivePool = jest.fn();
    findUnique = jest.fn();
    upsert = jest.fn();
    deleteMany = jest.fn();
    findMany = jest.fn();
    count = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionsService,
        {
          provide: PrismaService,
          useValue: {
            mission: { findUnique },
            savedMission: { upsert, deleteMany, findMany, count },
          },
        },
        {
          provide: MissionPoolService,
          useValue: { getActivePool },
        },
      ],
    }).compile();

    service = module.get(MissionsService);
  });

  /** Convenience: seed the mocked pool then run generate with a full DTO. */
  async function generate(pool: Mission[], dto: Partial<GenerateMissionsDto> = {}) {
    getActivePool.mockResolvedValue(pool);
    return service.generate({ ...BASE_DTO, ...dto });
  }

  describe('candidate query', () => {
    it('reads the active mission pool from MissionPoolService (cached)', async () => {
      await generate([]);
      expect(getActivePool).toHaveBeenCalledTimes(1);
    });
  });

  describe('time ceiling rule', () => {
    it('includes a mission exactly at the requested ceiling', async () => {
      const pool = [makeMission({ id: 'at-ceiling', estimatedMinutes: 30 })];
      const res = await generate(pool, { time: '30 min' });
      expect(res.missions.map((m) => m.id)).toEqual(['at-ceiling']);
    });

    it('excludes a mission one minute over the ceiling', async () => {
      const pool = [makeMission({ id: 'over', estimatedMinutes: 31 })];
      const res = await generate(pool, { time: '30 min' });
      expect(res.missions).toEqual([]);
    });

    it("maps '2+ hours' to a 999-minute ceiling so long missions still appear", async () => {
      const pool = [makeMission({ id: 'long', estimatedMinutes: 120 })];
      const res = await generate(pool, { time: '2+ hours' });
      expect(res.missions.map((m) => m.id)).toEqual(['long']);
    });
  });

  describe('budget tier rule', () => {
    it('includes a mission exactly at the requested tier', async () => {
      const pool = [makeMission({ id: 'at-tier', costTier: 2 })];
      const res = await generate(pool, { budget: 'Under $30' });
      expect(res.missions.map((m) => m.id)).toEqual(['at-tier']);
    });

    it('excludes a mission one tier over the budget', async () => {
      const pool = [makeMission({ id: 'pricey', costTier: 3 })];
      const res = await generate(pool, { budget: 'Under $30' });
      expect(res.missions).toEqual([]);
    });

    it("maps 'Free' to tier 0 — only free missions qualify", async () => {
      const pool = [
        makeMission({ id: 'free', costTier: 0 }),
        makeMission({ id: 'paid', costTier: 1 }),
      ];
      const res = await generate(pool, { budget: 'Free' });
      expect(res.missions.map((m) => m.id)).toEqual(['free']);
    });
  });

  describe('crew rule', () => {
    it('includes a mission whose crewTags contain the requested crew', async () => {
      const pool = [makeMission({ id: 'kids', crewTags: ['Family', 'Kids Mode'] })];
      const res = await generate(pool, { crew: 'Kids Mode' });
      expect(res.missions.map((m) => m.id)).toEqual(['kids']);
    });

    it('excludes a mission whose crewTags do not contain the requested crew', async () => {
      const pool = [makeMission({ id: 'solo-only', crewTags: ['Solo'] })];
      const res = await generate(pool, { crew: 'Family' });
      expect(res.missions).toEqual([]);
    });
  });

  describe('setting rule', () => {
    it('includes a mission whose settingTags contain the requested setting', async () => {
      const pool = [makeMission({ id: 'nature', settingTags: ['Nature'] })];
      const res = await generate(pool, { setting: 'Nature' });
      expect(res.missions.map((m) => m.id)).toEqual(['nature']);
    });

    it('excludes a mission whose settingTags do not contain the requested setting', async () => {
      const pool = [makeMission({ id: 'indoor-only', settingTags: ['Indoors'] })];
      const res = await generate(pool, { setting: 'Nature' });
      expect(res.missions).toEqual([]);
    });

    it("'Anywhere' matches a mission regardless of its settingTags", async () => {
      const pool = [makeMission({ id: 'niche', settingTags: ['Nature'] })];
      const res = await generate(pool, { setting: 'Anywhere' });
      expect(res.missions.map((m) => m.id)).toEqual(['niche']);
    });
  });

  describe('rules are independent (one match is not enough)', () => {
    it('excludes a mission with a matching crew but the wrong setting', async () => {
      const pool = [
        makeMission({ id: 'crew-ok-setting-bad', crewTags: ['Family'], settingTags: ['Indoors'] }),
      ];
      const res = await generate(pool, { crew: 'Family', setting: 'Nature' });
      expect(res.missions).toEqual([]);
    });

    it('excludes a mission within time/budget but with the wrong crew', async () => {
      const pool = [
        makeMission({
          id: 'time-ok-crew-bad',
          estimatedMinutes: 10,
          costTier: 0,
          crewTags: ['Solo'],
        }),
      ];
      const res = await generate(pool, { crew: 'Family', time: '30 min', budget: 'Free' });
      expect(res.missions).toEqual([]);
    });
  });

  describe('random selection', () => {
    it('returns an empty list (not an error) when the pool is empty', async () => {
      const res = await generate([]);
      expect(res).toEqual({ missions: [] });
    });

    it('returns every match when fewer than 3 qualify', async () => {
      const pool = [makeMission({ id: 'a' }), makeMission({ id: 'b' })];
      const res = await generate(pool);
      expect(res.missions).toHaveLength(2);
      expect(res.missions.map((m) => m.id).sort()).toEqual(['a', 'b']);
    });

    it('caps the result at 3 even when more qualify', async () => {
      const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => makeMission({ id }));
      const res = await generate(pool);
      expect(res.missions).toHaveLength(3);
      const ids = res.missions.map((m) => m.id);
      expect(new Set(ids).size).toBe(3); // distinct — no duplicates from the shuffle
      ids.forEach((id) => expect(['a', 'b', 'c', 'd', 'e']).toContain(id));
    });

    it('shuffles: the chosen 3 are drawn from across the pool, not just the head', async () => {
      const pool = Array.from({ length: 10 }, (_, i) => makeMission({ id: `m${i}` }));
      // Force a deterministic non-identity shuffle so the assertion is stable.
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
      const res = await generate(pool);
      randomSpy.mockRestore();
      expect(res.missions).toHaveLength(3);
    });
  });

  describe('response field mapping', () => {
    it('renames DB columns to the mobile short-field contract and formats time/xp', async () => {
      const pool = [
        makeMission({
          id: 'uuid-1',
          title: 'Find the Oldest Thing',
          category: MissionCategory.discover,
          description: 'Short teaser.',
          fullBrief: 'The long brief.',
          proofRequirement: 'Photograph it.',
          estimatedMinutes: 20,
          xpReward: 40,
          difficulty: MissionDifficulty.Medium,
          difficultyDots: 2,
        }),
      ];
      const res = await generate(pool);
      expect(res.missions[0]).toEqual({
        id: 'uuid-1',
        category: 'discover',
        title: 'Find the Oldest Thing',
        desc: 'Short teaser.',
        full: 'The long brief.',
        proof: 'Photograph it.',
        time: '20 min',
        xp: '+40 XP',
        diff: 'Medium',
        dots: 2,
      });
    });
  });

  describe('getById', () => {
    it('returns the mission in the mobile short-field shape for an active mission', async () => {
      findUnique.mockResolvedValue(
        makeMission({
          id: MISSION_ID,
          title: 'Find the Oldest Thing',
          category: MissionCategory.discover,
          estimatedMinutes: 20,
          xpReward: 40,
          difficulty: MissionDifficulty.Medium,
          difficultyDots: 2,
        }),
      );

      const res = await service.getById(MISSION_ID);

      expect(findUnique).toHaveBeenCalledWith({ where: { id: MISSION_ID } });
      expect(res).toEqual({
        id: MISSION_ID,
        category: 'discover',
        title: 'Find the Oldest Thing',
        desc: 'Short teaser.',
        full: 'The full brief.',
        proof: 'A photo.',
        time: '20 min',
        xp: '+40 XP',
        diff: 'Medium',
        dots: 2,
      });
    });

    it('does not depend on the saved list (no savedMission read)', async () => {
      findUnique.mockResolvedValue(makeMission({ id: MISSION_ID }));
      await service.getById(MISSION_ID);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the mission does not exist', async () => {
      findUnique.mockResolvedValue(null);
      await expect(service.getById(MISSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the mission is inactive', async () => {
      findUnique.mockResolvedValue(makeMission({ id: MISSION_ID, isActive: false }));
      await expect(service.getById(MISSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the mission is soft-deleted', async () => {
      findUnique.mockResolvedValue(makeMission({ id: MISSION_ID, deletedAt: new Date() }));
      await expect(service.getById(MISSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('saveMission', () => {
    it('upserts a save for an active mission and returns { saved: true }', async () => {
      findUnique.mockResolvedValue({ id: MISSION_ID, isActive: true, deletedAt: null });
      upsert.mockResolvedValue({});

      const res = await service.saveMission(USER_ID, MISSION_ID);

      expect(res).toEqual({ saved: true });
      expect(upsert).toHaveBeenCalledWith({
        where: { userId_missionId: { userId: USER_ID, missionId: MISSION_ID } },
        create: { userId: USER_ID, missionId: MISSION_ID },
        update: {},
      });
    });

    it('is idempotent: saving twice never throws and still returns { saved: true } each time', async () => {
      findUnique.mockResolvedValue({ id: MISSION_ID, isActive: true, deletedAt: null });
      // upsert on the (userId, missionId) unique constraint no-ops the second
      // time instead of raising a conflict — both calls resolve identically.
      upsert.mockResolvedValue({});

      const first = await service.saveMission(USER_ID, MISSION_ID);
      const second = await service.saveMission(USER_ID, MISSION_ID);

      expect(first).toEqual({ saved: true });
      expect(second).toEqual({ saved: true });
      expect(upsert).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException when the mission does not exist', async () => {
      findUnique.mockResolvedValue(null);
      await expect(service.saveMission(USER_ID, MISSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the mission is inactive', async () => {
      findUnique.mockResolvedValue({ id: MISSION_ID, isActive: false, deletedAt: null });
      await expect(service.saveMission(USER_ID, MISSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the mission is soft-deleted', async () => {
      findUnique.mockResolvedValue({ id: MISSION_ID, isActive: true, deletedAt: new Date() });
      await expect(service.saveMission(USER_ID, MISSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('unsaveMission', () => {
    it('deletes the save and returns { saved: false }', async () => {
      deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.unsaveMission(USER_ID, MISSION_ID);

      expect(res).toEqual({ saved: false });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, missionId: MISSION_ID },
      });
    });

    it('is idempotent: deleting a non-existent save (count 0) does not throw', async () => {
      deleteMany.mockResolvedValue({ count: 0 });

      const first = await service.unsaveMission(USER_ID, MISSION_ID);
      const second = await service.unsaveMission(USER_ID, MISSION_ID);

      expect(first).toEqual({ saved: false });
      expect(second).toEqual({ saved: false });
      expect(deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('listSaved', () => {
    const SAVED_AT = new Date('2026-07-15T10:00:00.000Z');

    it('scopes to the caller, orders newest-saved-first, and applies default pagination', async () => {
      findMany.mockResolvedValue([
        { savedAt: SAVED_AT, mission: makeMission({ id: 'm1', title: 'Find the Oldest Thing' }) },
      ]);
      count.mockResolvedValue(1);

      const res = await service.listSaved(USER_ID, {});

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, mission: { isActive: true, deletedAt: null } },
        include: { mission: true },
        orderBy: { savedAt: 'desc' },
        take: 20,
        skip: 0,
      });
      expect(count).toHaveBeenCalledWith({
        where: { userId: USER_ID, mission: { isActive: true, deletedAt: null } },
      });
      expect(res).toEqual({
        items: [
          {
            id: 'm1',
            category: 'explore',
            title: 'Find the Oldest Thing',
            desc: 'Short teaser.',
            full: 'The full brief.',
            proof: 'A photo.',
            time: '10 min',
            xp: '+40 XP',
            diff: 'Easy',
            dots: 1,
            savedAt: SAVED_AT,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
    });

    it('honors an explicit limit/offset', async () => {
      findMany.mockResolvedValue([]);
      count.mockResolvedValue(0);

      await service.listSaved(USER_ID, { limit: 5, offset: 10 });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, skip: 10 }));
    });

    it('returns an empty page (not an error) when nothing is saved', async () => {
      findMany.mockResolvedValue([]);
      count.mockResolvedValue(0);

      const res = await service.listSaved(USER_ID, {});

      expect(res).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    });
  });
});
