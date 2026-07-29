import { ConflictException, NotFoundException } from '@nestjs/common';
import { MissionTag, Prisma } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminMissionTagsService, MissionTagActionContext } from './admin-mission-tags.service';

const CTX: MissionTagActionContext = {
  actorAdminUserId: 'admin-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function buildTag(overrides: Partial<MissionTag> = {}): MissionTag {
  return {
    id: 'tag-1',
    type: 'Crew',
    value: 'Solo',
    label: 'Solo',
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function duplicateError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('AdminMissionTagsService', () => {
  let prisma: {
    missionTag: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let audit: { record: jest.Mock };
  let service: AdminMissionTagsService;

  beforeEach(() => {
    prisma = {
      missionTag: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new AdminMissionTagsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
    );
  });

  describe('list', () => {
    it('filters active-only by default and returns items + total', async () => {
      prisma.missionTag.findMany.mockResolvedValue([buildTag(), buildTag({ id: 'tag-2' })]);

      const result = await service.list({});

      expect(prisma.missionTag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it('includes inactive tags when asked and filters by type', async () => {
      await service.list({ type: 'Setting', includeInactive: true });
      expect(prisma.missionTag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: 'Setting' } }),
      );
    });
  });

  describe('create', () => {
    it('creates a tag and writes an audit record', async () => {
      const tag = buildTag();
      prisma.missionTag.create.mockResolvedValue(tag);

      const result = await service.create({ type: 'Crew', value: 'Solo', label: 'Solo' }, CTX);

      expect(result.value).toBe('Solo');
      expect(prisma.missionTag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: true, sortOrder: 0 }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.tags.create', targetType: 'MissionTag' }),
      );
    });

    it('maps a unique-constraint violation to 409', async () => {
      prisma.missionTag.create.mockRejectedValue(duplicateError());

      await expect(
        service.create({ type: 'Crew', value: 'Solo', label: 'Solo' }, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows a non-duplicate error unchanged', async () => {
      prisma.missionTag.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.create({ type: 'Crew', value: 'Solo', label: 'Solo' }, CTX),
      ).rejects.toThrow('db down');
    });
  });

  describe('update', () => {
    it('throws 404 when the tag does not exist', async () => {
      prisma.missionTag.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { label: 'x' }, CTX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.missionTag.update).not.toHaveBeenCalled();
    });

    it('applies only the provided fields and audits before/after', async () => {
      prisma.missionTag.findUnique.mockResolvedValue(buildTag({ label: 'Solo' }));
      prisma.missionTag.update.mockResolvedValue(buildTag({ label: 'Solo Adventurer' }));

      const result = await service.update('tag-1', { label: 'Solo Adventurer' }, CTX);

      expect(prisma.missionTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: { label: 'Solo Adventurer' },
      });
      expect(result.label).toBe('Solo Adventurer');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.tags.update' }),
      );
    });

    it('maps a value-rename collision to 409', async () => {
      prisma.missionTag.findUnique.mockResolvedValue(buildTag());
      prisma.missionTag.update.mockRejectedValue(duplicateError());

      await expect(service.update('tag-1', { value: 'Partner' }, CTX)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows a non-duplicate update error unchanged', async () => {
      prisma.missionTag.findUnique.mockResolvedValue(buildTag());
      prisma.missionTag.update.mockRejectedValue(new Error('db down'));

      await expect(service.update('tag-1', { label: 'x' }, CTX)).rejects.toThrow('db down');
    });
  });

  describe('deactivate', () => {
    it('throws 404 when the tag does not exist', async () => {
      prisma.missionTag.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('missing', CTX)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets isActive false and audits when currently active', async () => {
      prisma.missionTag.findUnique.mockResolvedValue(buildTag({ isActive: true }));
      prisma.missionTag.update.mockResolvedValue(buildTag({ isActive: false }));

      const result = await service.deactivate('tag-1', CTX);

      expect(prisma.missionTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'challenges.tags.deactivate' }),
      );
    });

    it('is an idempotent no-op (no write, no audit) when already inactive', async () => {
      prisma.missionTag.findUnique.mockResolvedValue(buildTag({ isActive: false }));

      const result = await service.deactivate('tag-1', CTX);

      expect(prisma.missionTag.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(result.isActive).toBe(false);
    });
  });
});
