import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModerationTargetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

const REPORTER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_ID = '33333333-3333-3333-3333-333333333333';

interface TxMock {
  report: { upsert: jest.Mock; findMany: jest.Mock };
  hiddenContent: { upsert: jest.Mock };
  globalContentHide: { upsert: jest.Mock };
}

describe('ReportsService', () => {
  let service: ReportsService;
  let tx: TxMock;
  let prisma: {
    $transaction: jest.Mock;
    completion: { findUnique: jest.Mock };
    userTaskSubmission: { findUnique: jest.Mock };
    user: { findFirst: jest.Mock };
    hiddenContent: { findMany: jest.Mock; findUnique: jest.Mock };
    globalContentHide: { findMany: jest.Mock; findUnique: jest.Mock };
  };

  const dto: CreateReportDto = {
    targetType: ModerationTargetType.Completion,
    targetId: TARGET_ID,
    reason: 'Inappropriate photo',
  };

  function makeReport(overrides: Record<string, unknown> = {}) {
    return {
      id: 'report-1',
      reporterUserId: REPORTER_ID,
      targetType: ModerationTargetType.Completion,
      targetId: TARGET_ID,
      reason: 'Inappropriate photo',
      details: null,
      status: 'Open',
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    tx = {
      report: { upsert: jest.fn(), findMany: jest.fn() },
      hiddenContent: { upsert: jest.fn().mockResolvedValue({}) },
      globalContentHide: { upsert: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((cb: (t: TxMock) => Promise<unknown>) => cb(tx)),
      completion: { findUnique: jest.fn() },
      userTaskSubmission: { findUnique: jest.fn() },
      user: { findFirst: jest.fn() },
      hiddenContent: { findMany: jest.fn(), findUnique: jest.fn() },
      globalContentHide: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  describe('createReport — reporter-local hide', () => {
    it('creates the report, hides the target for the reporter, and does NOT globally hide on the first report', async () => {
      prisma.completion.findUnique.mockResolvedValue({ id: TARGET_ID });
      tx.report.upsert.mockResolvedValue(makeReport());
      // Only this reporter so far.
      tx.report.findMany.mockResolvedValue([{ reporterUserId: REPORTER_ID }]);

      const res = await service.createReport(REPORTER_ID, dto);

      expect(tx.report.upsert).toHaveBeenCalledWith({
        where: {
          reporterUserId_targetType_targetId: {
            reporterUserId: REPORTER_ID,
            targetType: ModerationTargetType.Completion,
            targetId: TARGET_ID,
          },
        },
        create: {
          reporterUserId: REPORTER_ID,
          targetType: ModerationTargetType.Completion,
          targetId: TARGET_ID,
          reason: 'Inappropriate photo',
          details: null,
        },
        update: {},
      });
      expect(tx.hiddenContent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_targetType_targetId: {
              userId: REPORTER_ID,
              targetType: ModerationTargetType.Completion,
              targetId: TARGET_ID,
            },
          },
          create: expect.objectContaining({ userId: REPORTER_ID, reportId: 'report-1' }),
        }),
      );
      expect(tx.globalContentHide.upsert).not.toHaveBeenCalled();
      expect(res).toEqual({
        reportId: 'report-1',
        status: 'Open',
        targetType: ModerationTargetType.Completion,
        targetId: TARGET_ID,
        hiddenForReporter: true,
        globallyHidden: false,
        createdAt: new Date('2026-07-28T00:00:00.000Z'),
      });
    });

    it('is idempotent per (reporter, target): the constraint-backed upsert reuses one row (deterministic reportId)', async () => {
      prisma.completion.findUnique.mockResolvedValue({ id: TARGET_ID });
      // The upsert collapses a repeat report onto the existing row via the
      // @@unique([reporterUserId, targetType, targetId]) constraint.
      tx.report.upsert.mockResolvedValue(makeReport({ id: 'existing' }));
      tx.report.findMany.mockResolvedValue([{ reporterUserId: REPORTER_ID }]);

      const res = await service.createReport(REPORTER_ID, dto);

      expect(tx.report.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
      expect(res.reportId).toBe('existing');
      expect(res.globallyHidden).toBe(false);
    });
  });

  describe('createReport — global-hide escalation', () => {
    it('globally hides the target once a second distinct user has reported it', async () => {
      prisma.completion.findUnique.mockResolvedValue({ id: TARGET_ID });
      tx.report.upsert.mockResolvedValue(makeReport({ reporterUserId: OTHER_ID }));
      // Two distinct reporters now exist for this target.
      tx.report.findMany.mockResolvedValue([
        { reporterUserId: REPORTER_ID },
        { reporterUserId: OTHER_ID },
      ]);

      const res = await service.createReport(OTHER_ID, dto);

      expect(tx.globalContentHide.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            targetType_targetId: {
              targetType: ModerationTargetType.Completion,
              targetId: TARGET_ID,
            },
          },
        }),
      );
      expect(res.globallyHidden).toBe(true);
    });

    it('counts distinct reporters (via Prisma distinct), so one user reporting twice does not escalate', async () => {
      prisma.completion.findUnique.mockResolvedValue({ id: TARGET_ID });
      tx.report.upsert.mockResolvedValue(makeReport());
      // distinct on reporterUserId collapses the same reporter to one row.
      tx.report.findMany.mockResolvedValue([{ reporterUserId: REPORTER_ID }]);

      const res = await service.createReport(REPORTER_ID, dto);

      expect(tx.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ distinct: ['reporterUserId'] }),
      );
      expect(tx.globalContentHide.upsert).not.toHaveBeenCalled();
      expect(res.globallyHidden).toBe(false);
    });
  });

  describe('createReport — validation', () => {
    it('rejects reporting your own account with a 400', async () => {
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ModerationTargetType.User,
          targetId: REPORTER_ID,
          reason: 'self',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the completion target does not exist', async () => {
      prisma.completion.findUnique.mockResolvedValue(null);
      await expect(service.createReport(REPORTER_ID, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404s when a reported user target is soft-deleted (findFirst with deletedAt:null returns null)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ModerationTargetType.User,
          targetId: OTHER_ID,
          reason: 'abuse',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves a UserTaskSubmission target via its own table', async () => {
      prisma.userTaskSubmission.findUnique.mockResolvedValue({ id: TARGET_ID });
      tx.report.upsert.mockResolvedValue(
        makeReport({ targetType: ModerationTargetType.UserTaskSubmission }),
      );
      tx.report.findMany.mockResolvedValue([{ reporterUserId: REPORTER_ID }]);

      const res = await service.createReport(REPORTER_ID, {
        targetType: ModerationTargetType.UserTaskSubmission,
        targetId: TARGET_ID,
        reason: 'cheating',
      });

      expect(prisma.userTaskSubmission.findUnique).toHaveBeenCalled();
      expect(res.hiddenForReporter).toBe(true);
    });
  });

  describe('hide-visibility helpers', () => {
    it('listHiddenTargetIds returns the ids the user has hidden for a type', async () => {
      prisma.hiddenContent.findMany.mockResolvedValue([{ targetId: 'a' }, { targetId: 'b' }]);

      const ids = await service.listHiddenTargetIds(REPORTER_ID, ModerationTargetType.Completion);

      expect(ids).toEqual(['a', 'b']);
      expect(prisma.hiddenContent.findMany).toHaveBeenCalledWith({
        where: { userId: REPORTER_ID, targetType: ModerationTargetType.Completion },
        select: { targetId: true },
      });
    });

    it('filterHiddenTargetIds unions global and reporter-local hides, scoped to the candidate ids', async () => {
      prisma.globalContentHide.findMany.mockResolvedValue([{ targetId: 'a' }]);
      prisma.hiddenContent.findMany.mockResolvedValue([{ targetId: 'b' }]);

      const hidden = await service.filterHiddenTargetIds(
        REPORTER_ID,
        ModerationTargetType.UserTaskSubmission,
        ['a', 'b', 'c'],
      );

      expect(hidden).toEqual(new Set(['a', 'b']));
      expect(prisma.globalContentHide.findMany).toHaveBeenCalledWith({
        where: {
          targetType: ModerationTargetType.UserTaskSubmission,
          targetId: { in: ['a', 'b', 'c'] },
        },
        select: { targetId: true },
      });
      expect(prisma.hiddenContent.findMany).toHaveBeenCalledWith({
        where: {
          userId: REPORTER_ID,
          targetType: ModerationTargetType.UserTaskSubmission,
          targetId: { in: ['a', 'b', 'c'] },
        },
        select: { targetId: true },
      });
    });

    it('filterHiddenTargetIds short-circuits with no DB round trip on an empty candidate list', async () => {
      const hidden = await service.filterHiddenTargetIds(
        REPORTER_ID,
        ModerationTargetType.UserTaskSubmission,
        [],
      );

      expect(hidden.size).toBe(0);
      expect(prisma.globalContentHide.findMany).not.toHaveBeenCalled();
      expect(prisma.hiddenContent.findMany).not.toHaveBeenCalled();
    });

    it('isHiddenForUser is true when a global hide exists', async () => {
      prisma.globalContentHide.findUnique.mockResolvedValue({ id: 'g1' });
      prisma.hiddenContent.findUnique.mockResolvedValue(null);

      await expect(
        service.isHiddenForUser(REPORTER_ID, ModerationTargetType.Completion, TARGET_ID),
      ).resolves.toBe(true);
    });

    it('isHiddenForUser is true when only a reporter-local hide exists', async () => {
      prisma.globalContentHide.findUnique.mockResolvedValue(null);
      prisma.hiddenContent.findUnique.mockResolvedValue({ id: 'h1' });

      await expect(
        service.isHiddenForUser(REPORTER_ID, ModerationTargetType.Completion, TARGET_ID),
      ).resolves.toBe(true);
    });

    it('isHiddenForUser is false when neither hide exists', async () => {
      prisma.globalContentHide.findUnique.mockResolvedValue(null);
      prisma.hiddenContent.findUnique.mockResolvedValue(null);

      await expect(
        service.isHiddenForUser(REPORTER_ID, ModerationTargetType.Completion, TARGET_ID),
      ).resolves.toBe(false);
    });
  });
});
