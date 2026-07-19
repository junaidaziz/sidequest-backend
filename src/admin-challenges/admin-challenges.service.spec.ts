import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Mission, MissionStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MissionPoolService } from '../missions/mission-pool.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminChallengesService, AdminMissionActionContext } from './admin-challenges.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { ListMissionsQueryDto } from './dto/list-missions-query.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';

function buildMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    title: 'Sunrise Sketch',
    category: 'create',
    description: 'A short teaser.',
    fullBrief: 'The full brief.',
    proofRequirement: 'A photo.',
    estimatedMinutes: 30,
    xpReward: 40,
    difficulty: 'Easy',
    difficultyDots: 1,
    crewTags: ['Solo'],
    settingTags: ['Outdoors'],
    costTier: 0,
    isActive: false,
    status: MissionStatus.Draft,
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
    createdByAdminId: 'admin-1',
    createdAt: new Date('2026-07-01'),
    updatedAt: new Date('2026-07-01'),
    deletedAt: null,
    ...overrides,
  };
}

const CTX: AdminMissionActionContext = {
  actorAdminUserId: 'admin-1',
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
};

function validCreateDto(overrides: Partial<CreateMissionDto> = {}): CreateMissionDto {
  return {
    title: 'New Mission',
    category: 'explore',
    description: 'desc',
    fullBrief: 'brief',
    proofRequirement: 'proof',
    estimatedMinutes: 20,
    xpReward: 30,
    difficulty: 'Medium',
    difficultyDots: 2,
    crewTags: ['Solo'],
    settingTags: ['Indoors'],
    costTier: 1,
    ...overrides,
  };
}

describe('AdminChallengesService', () => {
  let service: AdminChallengesService;
  let prisma: {
    mission: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    completion: { groupBy: jest.Mock; count: jest.Mock };
    savedMission: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let missionPool: { invalidate: jest.Mock };
  let tx: { $queryRaw: jest.Mock; mission: { update: jest.Mock } };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      mission: { update: jest.fn() },
    };
    prisma = {
      mission: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      completion: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      savedMission: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (t: typeof tx) => unknown)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    missionPool = { invalidate: jest.fn().mockResolvedValue(undefined) };

    service = new AdminChallengesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      missionPool as unknown as MissionPoolService,
    );
  });

  describe('list', () => {
    it('paginates, filters, and attaches completion counts', async () => {
      const rows = [buildMission({ id: 'm1' }), buildMission({ id: 'm2' })];
      prisma.mission.findMany.mockResolvedValue(rows);
      prisma.mission.count.mockResolvedValue(2);
      prisma.completion.groupBy.mockResolvedValue([{ missionId: 'm1', _count: { _all: 5 } }]);

      const query: ListMissionsQueryDto = {
        page: 2,
        pageSize: 10,
        status: MissionStatus.Published,
        featured: true,
        isActive: true,
        category: 'create',
        difficulty: 'Easy',
      };
      const res = await service.list(query);

      expect(res.total).toBe(2);
      expect(res.page).toBe(2);
      expect(res.items[0].completionCount).toBe(5);
      expect(res.items[1].completionCount).toBe(0);
      expect(prisma.mission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            status: MissionStatus.Published,
            featured: true,
            isActive: true,
            category: 'create',
            difficulty: 'Easy',
          },
          skip: 10,
          take: 10,
        }),
      );
    });

    it('applies list defaults and skips the count query when the page is empty', async () => {
      prisma.mission.findMany.mockResolvedValue([]);
      prisma.mission.count.mockResolvedValue(0);

      const res = await service.list({});

      expect(res.page).toBe(1);
      expect(res.pageSize).toBe(25);
      expect(prisma.completion.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns detail with completion + saved counts', async () => {
      prisma.mission.findFirst.mockResolvedValue(buildMission());
      prisma.completion.count.mockResolvedValue(3);
      prisma.savedMission.count.mockResolvedValue(7);

      const res = await service.getById('mission-1');

      expect(res.id).toBe('mission-1');
      expect(res.completionCount).toBe(3);
      expect(res.savedCount).toBe(7);
    });

    it('throws NotFound when the mission is missing', async () => {
      prisma.mission.findFirst.mockResolvedValue(null);
      await expect(service.getById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a Draft authored by the caller and records an audit entry', async () => {
      const created = buildMission({ id: 'new', title: 'New Mission' });
      prisma.mission.create.mockResolvedValue(created);

      const res = await service.create(validCreateDto(), CTX);

      expect(res.status).toBe(MissionStatus.Draft);
      expect(prisma.mission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MissionStatus.Draft,
            isActive: false,
            featured: false,
            createdByAdminId: 'admin-1',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.create', targetType: 'Mission' }),
      );
      // A fresh Draft is invisible to the generator, so no cache bust is needed.
      expect(missionPool.invalidate).not.toHaveBeenCalled();
    });

    it('passes milestones and dates through', async () => {
      prisma.mission.create.mockResolvedValue(buildMission());
      await service.create(
        validCreateDto({
          startDate: '2026-08-01T00:00:00.000Z',
          endDate: '2026-08-10T00:00:00.000Z',
          milestones: [{ title: 'step 1' }],
        }),
        CTX,
      );
      const arg = prisma.mission.create.mock.calls[0][0].data;
      expect(arg.startDate).toBeInstanceOf(Date);
      expect(arg.milestones).toEqual([{ title: 'step 1' }]);
    });

    it('rejects an inverted date window with 400', async () => {
      await expect(
        service.create(
          validCreateDto({ startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-08-01T00:00:00.000Z' }),
          CTX,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.mission.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate-title P2002 to 409', async () => {
      prisma.mission.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5',
        }),
      );
      await expect(service.create(validCreateDto(), CTX)).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws a non-P2002 error unchanged', async () => {
      const boom = new Error('db down');
      prisma.mission.create.mockRejectedValue(boom);
      await expect(service.create(validCreateDto(), CTX)).rejects.toBe(boom);
    });
  });

  describe('update', () => {
    it('updates content and busts the cache when the mission is active', async () => {
      prisma.mission.findFirst.mockResolvedValue(buildMission({ isActive: true }));
      prisma.mission.update.mockResolvedValue(buildMission({ isActive: true, description: 'new' }));

      const dto: UpdateMissionDto = { description: 'new', title: 'Renamed', category: 'discover', difficulty: 'Hard' };
      await service.update('mission-1', dto, CTX);

      expect(prisma.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mission-1' },
          data: expect.objectContaining({ description: 'new', title: 'Renamed', category: 'discover', difficulty: 'Hard' }),
        }),
      );
      expect(missionPool.invalidate).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.edit' }),
      );
    });

    it('does not bust the cache when editing an inactive draft', async () => {
      prisma.mission.findFirst.mockResolvedValue(buildMission({ isActive: false }));
      prisma.mission.update.mockResolvedValue(buildMission({ isActive: false }));

      await service.update('mission-1', { description: 'x' }, CTX);
      expect(missionPool.invalidate).not.toHaveBeenCalled();
    });

    it('validates the date window against existing values', async () => {
      prisma.mission.findFirst.mockResolvedValue(
        buildMission({ startDate: new Date('2026-09-01T00:00:00.000Z') }),
      );
      await expect(
        service.update('mission-1', { endDate: '2026-08-01T00:00:00.000Z' }, CTX),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound for a missing mission', async () => {
      prisma.mission.findFirst.mockResolvedValue(null);
      await expect(service.update('nope', { description: 'x' }, CTX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps a title clash on update to 409', async () => {
      prisma.mission.findFirst.mockResolvedValue(buildMission());
      prisma.mission.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(service.update('mission-1', { title: 'Taken' }, CTX)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('publish', () => {
    it('sets Published + isActive + approval stamp, busts cache, audits', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Draft, isActive: false, deletedAt: null },
      ]);
      tx.mission.update.mockResolvedValue(
        buildMission({ status: MissionStatus.Published, isActive: true, approvedAt: new Date() }),
      );

      const res = await service.publish('mission-1', CTX, 'go live');

      expect(res.status).toBe(MissionStatus.Published);
      expect(tx.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MissionStatus.Published,
            isActive: true,
            approvedByAdminId: 'admin-1',
          }),
        }),
      );
      expect(missionPool.invalidate).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.publish', reason: 'go live' }),
      );
    });

    it('conflicts when already published', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Published, isActive: true, deletedAt: null },
      ]);
      await expect(service.publish('mission-1', CTX)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.mission.update).not.toHaveBeenCalled();
    });

    it('404s when the locked row is missing or deleted', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.publish('mission-1', CTX)).rejects.toBeInstanceOf(NotFoundException);

      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Draft, isActive: false, deletedAt: new Date() },
      ]);
      await expect(service.publish('mission-1', CTX)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unpublish', () => {
    it('reverts a published mission to Draft + clears approval + busts cache', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Published, isActive: true, deletedAt: null },
      ]);
      tx.mission.update.mockResolvedValue(buildMission({ status: MissionStatus.Draft, isActive: false }));

      const res = await service.unpublish('mission-1', CTX);

      expect(res.status).toBe(MissionStatus.Draft);
      expect(tx.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false, approvedAt: null, approvedByAdminId: null }),
        }),
      );
      expect(missionPool.invalidate).toHaveBeenCalled();
    });

    it('conflicts when the mission is not published', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Draft, isActive: false, deletedAt: null },
      ]);
      await expect(service.unpublish('mission-1', CTX)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('archive', () => {
    it('archives + deactivates + busts cache', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Published, isActive: true, deletedAt: null },
      ]);
      tx.mission.update.mockResolvedValue(buildMission({ status: MissionStatus.Archived, isActive: false }));

      const res = await service.archive('mission-1', CTX);
      expect(res.status).toBe(MissionStatus.Archived);
      expect(missionPool.invalidate).toHaveBeenCalled();
    });

    it('conflicts when already archived', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Archived, isActive: false, deletedAt: null },
      ]);
      await expect(service.archive('mission-1', CTX)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('setFeatured', () => {
    it('features without touching the generator cache', async () => {
      prisma.mission.findFirst.mockResolvedValue(buildMission({ featured: false }));
      prisma.mission.update.mockResolvedValue(buildMission({ featured: true }));

      const res = await service.setFeatured('mission-1', true, CTX);
      expect(res.featured).toBe(true);
      expect(prisma.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { featured: true } }),
      );
      expect(missionPool.invalidate).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.feature' }),
      );
    });

    it('unfeatures', async () => {
      prisma.mission.findFirst.mockResolvedValue(buildMission({ featured: true }));
      prisma.mission.update.mockResolvedValue(buildMission({ featured: false }));
      const res = await service.setFeatured('mission-1', false, CTX);
      expect(res.featured).toBe(false);
    });

    it('404s on a missing mission', async () => {
      prisma.mission.findFirst.mockResolvedValue(null);
      await expect(service.setFeatured('nope', true, CTX)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('duplicate', () => {
    it('clones as a Draft with an available (Copy) title, clearing approval', async () => {
      prisma.mission.findFirst.mockResolvedValue(
        buildMission({ id: 'src', title: 'Original', status: MissionStatus.Published, approvedAt: new Date() }),
      );
      prisma.mission.findUnique.mockResolvedValue(null); // "(Copy)" is free
      prisma.mission.create.mockResolvedValue(
        buildMission({ id: 'clone', title: 'Original (Copy)', status: MissionStatus.Draft }),
      );

      const res = await service.duplicate('src', CTX);

      expect(res.id).toBe('clone');
      const data = prisma.mission.create.mock.calls[0][0].data;
      expect(data.title).toBe('Original (Copy)');
      expect(data.status).toBe(MissionStatus.Draft);
      expect(data.isActive).toBe(false);
      expect(data.approvedByAdminId).toBeNull();
      expect(data.createdByAdminId).toBe('admin-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.create', reason: 'duplicated' }),
      );
    });

    it('increments the suffix when the first copy title is taken', async () => {
      prisma.mission.findFirst.mockResolvedValue(buildMission({ title: 'Original' }));
      prisma.mission.findUnique
        .mockResolvedValueOnce({ id: 'x' }) // "(Copy)" taken
        .mockResolvedValueOnce(null); // "(Copy 2)" free
      prisma.mission.create.mockResolvedValue(buildMission({ title: 'Original (Copy 2)' }));

      await service.duplicate('src', CTX);
      expect(prisma.mission.create.mock.calls[0][0].data.title).toBe('Original (Copy 2)');
    });

    it('deep-clones milestones JSON', async () => {
      prisma.mission.findFirst.mockResolvedValue(
        buildMission({ title: 'Original', milestones: [{ title: 'step' }] as unknown as Prisma.JsonValue }),
      );
      prisma.mission.findUnique.mockResolvedValue(null);
      prisma.mission.create.mockResolvedValue(buildMission());
      await service.duplicate('src', CTX);
      expect(prisma.mission.create.mock.calls[0][0].data.milestones).toEqual([{ title: 'step' }]);
    });

    it('404s on a missing source', async () => {
      prisma.mission.findFirst.mockResolvedValue(null);
      await expect(service.duplicate('nope', CTX)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft-deletes, busts the cache when it was active, preserves history', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Published, isActive: true, deletedAt: null },
      ]);
      tx.mission.update.mockResolvedValue(buildMission({ deletedAt: new Date(), isActive: false }));

      await service.remove('mission-1', CTX, 'retired');

      expect(tx.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(missionPool.invalidate).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.delete', reason: 'retired' }),
      );
    });

    it('does not bust the cache when the deleted mission was inactive', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Draft, isActive: false, deletedAt: null },
      ]);
      tx.mission.update.mockResolvedValue(buildMission({ deletedAt: new Date() }));
      await service.remove('mission-1', CTX);
      expect(missionPool.invalidate).not.toHaveBeenCalled();
    });

    it('404s when the row is missing or already deleted', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.remove('nope', CTX)).rejects.toBeInstanceOf(NotFoundException);

      tx.$queryRaw.mockResolvedValue([
        { id: 'mission-1', status: MissionStatus.Draft, isActive: false, deletedAt: new Date() },
      ]);
      await expect(service.remove('mission-1', CTX)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
