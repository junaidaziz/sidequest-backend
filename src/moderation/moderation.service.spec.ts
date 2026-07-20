import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppealStatus,
  ModerationActionType,
  ModerationTargetType,
  ReportStatus,
  VerificationStatus,
} from '@prisma/client';
import { AdminUsersService } from '../admin/admin-users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PermissionResolverService } from '../rbac/permission-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ModerationService } from './moderation.service';
import { ModerationActionContext, ModerationQueueSource } from './types/moderation';

const CTX: ModerationActionContext = {
  actorAdminUserId: 'admin-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};
const REPORT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const COMPLETION_ID = '33333333-3333-3333-3333-333333333333';
const APPEAL_ID = '44444444-4444-4444-4444-444444444444';
const ACTION_ID = '55555555-5555-5555-5555-555555555555';

interface TxMock {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  completion: { update: jest.Mock };
  user: { findUnique: jest.Mock };
  moderationAction: { create: jest.Mock; update: jest.Mock };
  appeal: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
}

describe('ModerationService', () => {
  let service: ModerationService;
  let tx: TxMock;
  let prisma: {
    $transaction: jest.Mock;
    completion: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    userTaskSubmission: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    report: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    moderationAction: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    appeal: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let storage: { getSignedDownloadUrl: jest.Mock };
  let resolver: { hasAll: jest.Mock };
  let adminUsers: { suspend: jest.Mock; reactivate: jest.Mock };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : (arg as (t: TxMock) => Promise<unknown>)(tx),
      ),
      completion: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
      userTaskSubmission: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
      report: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      moderationAction: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      appeal: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };
    // `createAction`/`decideAppeal` now run their user-state + moderationAction/appeal
    // writes inside `prisma.$transaction(async (tx) => ...)` (Phase 10 atomicity fix —
    // backend-eval D3-FAIL-1/D3-FAIL-2). Point `tx`'s model mocks at the SAME jest.fn()s
    // as `prisma`'s so every existing `prisma.x.mockResolvedValue(...)` / `expect(prisma.x)`
    // in this file keeps working regardless of whether the code under test reads/writes
    // through `this.prisma` or the `tx` passed into its transaction callback.
    tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      completion: { update: jest.fn() },
      user: prisma.user,
      moderationAction: {
        create: prisma.moderationAction.create,
        update: prisma.moderationAction.update,
      },
      appeal: { update: prisma.appeal.update, findUniqueOrThrow: prisma.appeal.findUniqueOrThrow },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    storage = { getSignedDownloadUrl: jest.fn().mockResolvedValue('signed://url') };
    resolver = { hasAll: jest.fn().mockResolvedValue(true) };
    adminUsers = {
      suspend: jest.fn().mockResolvedValue(undefined),
      reactivate: jest.fn().mockResolvedValue(undefined),
    };

    service = new ModerationService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      storage as unknown as StorageService,
      resolver as unknown as PermissionResolverService,
      adminUsers as unknown as AdminUsersService,
    );
  });

  // --- queue -------------------------------------------------------------

  describe('getQueue', () => {
    const completionRow = {
      id: COMPLETION_ID,
      userId: USER_ID,
      user: { displayName: 'Ann' },
      mission: { title: 'Explore' },
      verificationStatus: VerificationStatus.Pending,
      proofType: 'photo',
      proofText: null,
      proofKey: 'proof/key.jpg',
      xpAwarded: 40,
      completedAt: new Date('2026-07-19T10:00:00Z'),
    };
    const submissionRow = {
      id: 'sub-1',
      submittedById: 'user-2',
      submittedBy: { displayName: 'Bob' },
      task: { title: 'Challenge' },
      status: 'Submitted',
      notes: 'did it',
      attachments: [{ objectKey: 'att/key.jpg' }],
      submittedAt: new Date('2026-07-18T10:00:00Z'),
    };

    it('merges both sources, sorts newest-first, and presigns only page media', async () => {
      prisma.completion.count.mockResolvedValue(1);
      prisma.userTaskSubmission.count.mockResolvedValue(1);
      prisma.completion.findMany.mockResolvedValue([completionRow]);
      prisma.userTaskSubmission.findMany.mockResolvedValue([submissionRow]);

      const page = await service.getQueue({});

      expect(page.total).toBe(2);
      expect(page.pendingCompletions).toBe(1);
      expect(page.pendingTaskSubmissions).toBe(1);
      // Completion (Jul 19) sorts before submission (Jul 18).
      expect(page.items[0].source).toBe(ModerationQueueSource.Completion);
      expect(page.items[0].proofUrl).toBe('signed://url');
      expect(page.items[1].source).toBe(ModerationQueueSource.TaskSubmission);
      expect(page.items[1].proofText).toBe('did it');
      expect(storage.getSignedDownloadUrl).toHaveBeenCalledTimes(2);
    });

    it('narrows to completions only when source=completion', async () => {
      prisma.completion.count.mockResolvedValue(1);
      prisma.completion.findMany.mockResolvedValue([completionRow]);

      const page = await service.getQueue({ source: ModerationQueueSource.Completion });

      expect(prisma.userTaskSubmission.count).not.toHaveBeenCalled();
      expect(prisma.userTaskSubmission.findMany).not.toHaveBeenCalled();
      expect(page.total).toBe(1);
      expect(page.items).toHaveLength(1);
    });

    it('narrows to task submissions only when source=task_submission', async () => {
      prisma.userTaskSubmission.count.mockResolvedValue(1);
      prisma.userTaskSubmission.findMany.mockResolvedValue([{ ...submissionRow, attachments: [] }]);

      const page = await service.getQueue({ source: ModerationQueueSource.TaskSubmission });

      expect(prisma.completion.count).not.toHaveBeenCalled();
      expect(page.items[0].proofUrl).toBeNull();
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  // --- reports -----------------------------------------------------------

  describe('listReports', () => {
    it('builds status/targetType/reason filters and returns a page', async () => {
      prisma.report.findMany.mockResolvedValue([]);
      prisma.report.count.mockResolvedValue(0);

      const page = await service.listReports({
        status: ReportStatus.Open,
        targetType: ModerationTargetType.User,
        reason: 'spam',
      });

      const where = prisma.report.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.status).toBe(ReportStatus.Open);
      expect(where.targetType).toBe(ModerationTargetType.User);
      expect(where.reason).toEqual({ contains: 'spam', mode: 'insensitive' });
      expect(page.total).toBe(0);
    });
  });

  describe('getReport', () => {
    it('returns the report with mapped actions', async () => {
      prisma.report.findFirst.mockResolvedValue({
        id: REPORT_ID,
        reporterUserId: null,
        targetType: ModerationTargetType.User,
        targetId: USER_ID,
        reason: 'abuse',
        details: 'details',
        status: ReportStatus.Open,
        reviewedByAdminId: null,
        reviewedAt: null,
        resolutionNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        actions: [
          {
            id: ACTION_ID,
            reportId: REPORT_ID,
            adminUserId: 'admin-1',
            actionType: ModerationActionType.WarnUser,
            targetType: ModerationTargetType.User,
            targetId: USER_ID,
            targetUserId: USER_ID,
            reason: 'warned',
            expiresAt: null,
            reversedAt: null,
            createdAt: new Date(),
          },
        ],
      });

      const detail = await service.getReport(REPORT_ID);
      expect(detail.id).toBe(REPORT_ID);
      expect(detail.actions).toHaveLength(1);
      expect(detail.actions[0].actionType).toBe(ModerationActionType.WarnUser);
    });

    it('throws NotFound when missing', async () => {
      prisma.report.findFirst.mockResolvedValue(null);
      await expect(service.getReport(REPORT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateReport', () => {
    function openReport(overrides: Record<string, unknown> = {}) {
      return {
        id: REPORT_ID,
        status: ReportStatus.Open,
        reviewedByAdminId: null,
        reviewedAt: null,
        resolutionNote: null,
        ...overrides,
      };
    }

    it('stamps the reviewer when transitioning to a terminal status and audits', async () => {
      prisma.report.findFirst
        .mockResolvedValueOnce(openReport())
        // getReport() re-read at the end
        .mockResolvedValueOnce({
          ...openReport({ status: ReportStatus.Resolved }),
          reporterUserId: null,
          targetType: ModerationTargetType.User,
          targetId: USER_ID,
          reason: 'x',
          details: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          actions: [],
        });
      prisma.report.update.mockResolvedValue({});

      await service.updateReport(REPORT_ID, { status: ReportStatus.Resolved }, CTX);

      const data = prisma.report.update.mock.calls[0][0].data;
      expect(data.status).toBe(ReportStatus.Resolved);
      expect(data.reviewedByAdminId).toBe('admin-1');
      expect(data.reviewedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'moderation.manage_reports' }),
      );
    });

    it('does not stamp a reviewer for a non-terminal UnderReview transition', async () => {
      prisma.report.findFirst.mockResolvedValueOnce(openReport()).mockResolvedValueOnce({
        ...openReport({ status: ReportStatus.UnderReview }),
        reporterUserId: null,
        targetType: ModerationTargetType.User,
        targetId: USER_ID,
        reason: 'x',
        details: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        actions: [],
      });
      prisma.report.update.mockResolvedValue({});

      await service.updateReport(REPORT_ID, { status: ReportStatus.UnderReview }, CTX);
      const data = prisma.report.update.mock.calls[0][0].data;
      expect(data.reviewedByAdminId).toBeNull();
    });

    it('throws NotFound when the report is missing', async () => {
      prisma.report.findFirst.mockResolvedValue(null);
      await expect(
        service.updateReport(REPORT_ID, { status: ReportStatus.Resolved }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when the report is already terminal', async () => {
      prisma.report.findFirst.mockResolvedValue(openReport({ status: ReportStatus.Dismissed }));
      await expect(
        service.updateReport(REPORT_ID, { status: ReportStatus.Resolved }, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // --- actions -----------------------------------------------------------

  describe('createAction', () => {
    function report(overrides: Record<string, unknown> = {}) {
      return {
        id: REPORT_ID,
        targetType: ModerationTargetType.User,
        targetId: USER_ID,
        ...overrides,
      };
    }
    function createdAction(overrides: Record<string, unknown> = {}) {
      return {
        id: ACTION_ID,
        reportId: REPORT_ID,
        adminUserId: 'admin-1',
        actionType: ModerationActionType.WarnUser,
        targetType: ModerationTargetType.User,
        targetId: USER_ID,
        targetUserId: USER_ID,
        reason: 'r',
        expiresAt: null,
        reversedAt: null,
        createdAt: new Date(),
        ...overrides,
      };
    }

    it('throws NotFound when the report does not exist', async () => {
      prisma.report.findFirst.mockResolvedValue(null);
      await expect(
        service.createAction(
          REPORT_ID,
          { actionType: ModerationActionType.WarnUser, reason: 'r' },
          CTX,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reuses AdminUsersService.suspend for a SuspendUser action against an active user', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, suspendedAt: null, deletedAt: null });
      prisma.moderationAction.create.mockResolvedValue(
        createdAction({ actionType: ModerationActionType.SuspendUser }),
      );

      await service.createAction(
        REPORT_ID,
        { actionType: ModerationActionType.SuspendUser, reason: 'bad' },
        CTX,
      );

      expect(adminUsers.suspend).toHaveBeenCalledWith(USER_ID, { reason: 'bad' }, CTX, tx);
      expect(prisma.moderationAction.create).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'moderation.take_action' }),
      );
    });

    it('does not double-suspend an already-suspended user on a BanUser action', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        suspendedAt: new Date(),
        deletedAt: null,
      });
      prisma.moderationAction.create.mockResolvedValue(
        createdAction({ actionType: ModerationActionType.BanUser }),
      );

      await service.createAction(
        REPORT_ID,
        { actionType: ModerationActionType.BanUser, reason: 'ban' },
        CTX,
      );

      expect(adminUsers.suspend).not.toHaveBeenCalled();
      expect(prisma.moderationAction.create).toHaveBeenCalled();
    });

    it('reuses reactivate for a ReinstateUser action against a suspended user', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        suspendedAt: new Date(),
        deletedAt: null,
      });
      prisma.moderationAction.create.mockResolvedValue(
        createdAction({ actionType: ModerationActionType.ReinstateUser }),
      );

      await service.createAction(
        REPORT_ID,
        { actionType: ModerationActionType.ReinstateUser, reason: 'ok' },
        CTX,
      );

      expect(adminUsers.reactivate).toHaveBeenCalledWith(USER_ID, CTX, tx);
    });

    it('records a WarnUser action with no user-state side effect', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, suspendedAt: null, deletedAt: null });
      prisma.moderationAction.create.mockResolvedValue(createdAction());

      await service.createAction(
        REPORT_ID,
        { actionType: ModerationActionType.WarnUser, reason: 'warn' },
        CTX,
      );

      expect(adminUsers.suspend).not.toHaveBeenCalled();
      expect(adminUsers.reactivate).not.toHaveBeenCalled();
    });

    it('throws Conflict when the target account is deleted', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        suspendedAt: null,
        deletedAt: new Date(),
      });
      await expect(
        service.createAction(
          REPORT_ID,
          { actionType: ModerationActionType.SuspendUser, reason: 'x' },
          CTX,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFound when the resolved target user does not exist', async () => {
      prisma.report.findFirst.mockResolvedValue(report());
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.createAction(
          REPORT_ID,
          { actionType: ModerationActionType.SuspendUser, reason: 'x' },
          CTX,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest for a user-directed action on a Mission report (no owner)', async () => {
      prisma.report.findFirst.mockResolvedValue(
        report({ targetType: ModerationTargetType.Mission, targetId: 'm-1' }),
      );
      await expect(
        service.createAction(
          REPORT_ID,
          { actionType: ModerationActionType.WarnUser, reason: 'x' },
          CTX,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('denies a content action (HideContent) without moderation.remove_content (403)', async () => {
      prisma.report.findFirst.mockResolvedValue(
        report({ targetType: ModerationTargetType.Completion, targetId: COMPLETION_ID }),
      );
      resolver.hasAll.mockResolvedValue(false);
      await expect(
        service.createAction(
          REPORT_ID,
          { actionType: ModerationActionType.HideContent, reason: 'x' },
          CTX,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.moderationAction.create).not.toHaveBeenCalled();
    });

    it('records a content action under moderation.remove_content when permitted', async () => {
      prisma.report.findFirst.mockResolvedValue(
        report({ targetType: ModerationTargetType.Completion, targetId: COMPLETION_ID }),
      );
      resolver.hasAll.mockResolvedValue(true);
      prisma.completion.findUnique.mockResolvedValue({ userId: USER_ID });
      prisma.moderationAction.create.mockResolvedValue(
        createdAction({ actionType: ModerationActionType.RemoveContent }),
      );

      await service.createAction(
        REPORT_ID,
        { actionType: ModerationActionType.RemoveContent, reason: 'remove' },
        CTX,
      );

      expect(adminUsers.suspend).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'moderation.remove_content' }),
      );
    });

    it('resolves the target user from a UserTaskSubmission report', async () => {
      prisma.report.findFirst.mockResolvedValue(
        report({ targetType: ModerationTargetType.UserTaskSubmission, targetId: 'sub-1' }),
      );
      prisma.userTaskSubmission.findUnique.mockResolvedValue({ submittedById: USER_ID });
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, suspendedAt: null, deletedAt: null });
      prisma.moderationAction.create.mockResolvedValue(
        createdAction({ actionType: ModerationActionType.SuspendUser }),
      );

      await service.createAction(
        REPORT_ID,
        { actionType: ModerationActionType.SuspendUser, reason: 'x' },
        CTX,
      );
      expect(prisma.userTaskSubmission.findUnique).toHaveBeenCalled();
      expect(adminUsers.suspend).toHaveBeenCalledWith(USER_ID, { reason: 'x' }, CTX, tx);
    });

    it('honours an explicit targetUserId override and passes expiresAt through', async () => {
      prisma.report.findFirst.mockResolvedValue(
        report({ targetType: ModerationTargetType.Mission, targetId: 'm-1' }),
      );
      prisma.user.findUnique.mockResolvedValue({ id: 'u-x', suspendedAt: null, deletedAt: null });
      prisma.moderationAction.create.mockResolvedValue(
        createdAction({ actionType: ModerationActionType.SuspendUser, targetUserId: 'u-x' }),
      );

      await service.createAction(
        REPORT_ID,
        {
          actionType: ModerationActionType.SuspendUser,
          reason: 'x',
          targetUserId: 'u-x',
          expiresAt: '2026-08-01T00:00:00.000Z',
        },
        CTX,
      );

      const data = prisma.moderationAction.create.mock.calls[0][0].data;
      expect(data.targetUserId).toBe('u-x');
      expect(data.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('listActions', () => {
    it('filters by actionType/targetType/targetUserId', async () => {
      prisma.moderationAction.findMany.mockResolvedValue([]);
      prisma.moderationAction.count.mockResolvedValue(0);

      await service.listActions({
        actionType: ModerationActionType.BanUser,
        targetType: ModerationTargetType.User,
        targetUserId: USER_ID,
      });

      const where = prisma.moderationAction.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        actionType: ModerationActionType.BanUser,
        targetType: ModerationTargetType.User,
        targetUserId: USER_ID,
      });
    });
  });

  // --- appeals -----------------------------------------------------------

  describe('listAppeals', () => {
    it('filters by status and embeds the action', async () => {
      prisma.appeal.findMany.mockResolvedValue([]);
      prisma.appeal.count.mockResolvedValue(0);
      await service.listAppeals({ status: AppealStatus.Pending });
      const args = prisma.appeal.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: AppealStatus.Pending });
      expect(args.include).toEqual({ moderationAction: true });
    });
  });

  describe('decideAppeal', () => {
    function pendingAppeal(actionOverrides: Record<string, unknown> = {}) {
      return {
        id: APPEAL_ID,
        moderationActionId: ACTION_ID,
        appellantUserId: USER_ID,
        reason: 'appeal',
        status: AppealStatus.Pending,
        reviewedByAdminId: null,
        reviewedAt: null,
        decisionNote: null,
        createdAt: new Date(),
        moderationAction: {
          id: ACTION_ID,
          reportId: REPORT_ID,
          adminUserId: 'admin-1',
          actionType: ModerationActionType.SuspendUser,
          targetType: ModerationTargetType.User,
          targetId: USER_ID,
          targetUserId: USER_ID,
          reason: 'r',
          expiresAt: null,
          reversedAt: null,
          createdAt: new Date(),
          ...actionOverrides,
        },
      };
    }

    it('throws NotFound when the appeal is missing', async () => {
      prisma.appeal.findUnique.mockResolvedValue(null);
      await expect(
        service.decideAppeal(APPEAL_ID, { decision: AppealStatus.Upheld }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when the appeal is already decided', async () => {
      prisma.appeal.findUnique.mockResolvedValue({
        ...pendingAppeal(),
        status: AppealStatus.Denied,
      });
      await expect(
        service.decideAppeal(APPEAL_ID, { decision: AppealStatus.Upheld }, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('upheld reverses the action and reactivates a suspended user', async () => {
      prisma.appeal.findUnique.mockResolvedValue(pendingAppeal());
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, suspendedAt: new Date() });
      prisma.appeal.update.mockResolvedValue({});
      prisma.appeal.findUniqueOrThrow.mockResolvedValue(pendingAppeal());

      await service.decideAppeal(
        APPEAL_ID,
        { decision: AppealStatus.Upheld, decisionNote: 'valid' },
        CTX,
      );

      expect(prisma.moderationAction.update).toHaveBeenCalledWith({
        where: { id: ACTION_ID },
        data: { reversedAt: expect.any(Date) },
      });
      expect(adminUsers.reactivate).toHaveBeenCalledWith(USER_ID, CTX, tx);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'moderation.manage_appeals' }),
      );
    });

    it('upheld on a non-suspension action reverses without reactivating', async () => {
      prisma.appeal.findUnique.mockResolvedValue(
        pendingAppeal({ actionType: ModerationActionType.WarnUser }),
      );
      prisma.appeal.update.mockResolvedValue({});
      prisma.appeal.findUniqueOrThrow.mockResolvedValue(
        pendingAppeal({ actionType: ModerationActionType.WarnUser }),
      );

      await service.decideAppeal(APPEAL_ID, { decision: AppealStatus.Upheld }, CTX);
      expect(prisma.moderationAction.update).toHaveBeenCalled();
      expect(adminUsers.reactivate).not.toHaveBeenCalled();
    });

    it('upheld skips reactivate when the suspended user is already active', async () => {
      prisma.appeal.findUnique.mockResolvedValue(pendingAppeal());
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, suspendedAt: null });
      prisma.appeal.update.mockResolvedValue({});
      prisma.appeal.findUniqueOrThrow.mockResolvedValue(pendingAppeal());

      await service.decideAppeal(APPEAL_ID, { decision: AppealStatus.Upheld }, CTX);
      expect(adminUsers.reactivate).not.toHaveBeenCalled();
    });

    it('denied records the decision without reversing the action', async () => {
      prisma.appeal.findUnique.mockResolvedValue(pendingAppeal());
      prisma.appeal.update.mockResolvedValue({});
      prisma.appeal.findUniqueOrThrow.mockResolvedValue({
        ...pendingAppeal(),
        status: AppealStatus.Denied,
      });

      const result = await service.decideAppeal(APPEAL_ID, { decision: AppealStatus.Denied }, CTX);
      expect(prisma.moderationAction.update).not.toHaveBeenCalled();
      expect(adminUsers.reactivate).not.toHaveBeenCalled();
      expect(result.status).toBe(AppealStatus.Denied);
    });
  });

  // --- proof review (cutover) -------------------------------------------

  describe('reviewProof', () => {
    function lockedRow(overrides: Record<string, unknown> = {}) {
      return {
        id: COMPLETION_ID,
        userId: USER_ID,
        xpAwarded: 40,
        verificationStatus: VerificationStatus.Pending,
        ...overrides,
      };
    }

    it('locks the row with SELECT ... FOR UPDATE', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow()]);
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Approved,
        verifiedAt: new Date(),
        verifiedBy: 'admin',
        verifiedByAdminId: 'admin-1',
        rejectionReason: null,
      });

      await service.reviewProof(COMPLETION_ID, { status: VerificationStatus.Approved }, CTX);
      const [strings] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(strings.join('')).toContain('FOR UPDATE');
    });

    it('approves without touching XP and sets verifiedByAdminId + verifiedBy=admin', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow()]);
      const verifiedAt = new Date();
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Approved,
        verifiedAt,
        verifiedBy: 'admin',
        verifiedByAdminId: 'admin-1',
        rejectionReason: null,
      });

      const result = await service.reviewProof(
        COMPLETION_ID,
        { status: VerificationStatus.Approved },
        CTX,
      );

      const data = tx.completion.update.mock.calls[0][0].data;
      expect(data).toMatchObject({
        verificationStatus: VerificationStatus.Approved,
        verifiedBy: 'admin',
        verifiedByAdminId: 'admin-1',
        rejectionReason: null,
      });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(result.verifiedByAdminId).toBe('admin-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'proofs.review' }),
      );
    });

    it('rejects with an atomic clamped XP decrement', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow({ xpAwarded: 40 })]);
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Rejected,
        verifiedAt: new Date(),
        verifiedBy: 'admin',
        verifiedByAdminId: 'admin-1',
        rejectionReason: 'Blurry',
      });

      await service.reviewProof(
        COMPLETION_ID,
        { status: VerificationStatus.Rejected, rejectionReason: 'Blurry' },
        CTX,
      );

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = tx.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(strings.join('')).toContain('GREATEST(0, "totalXp" - ');
      expect(values).toContain(40);
      expect(values).toContain(USER_ID);
    });

    it('coerces a missing rejection reason to null', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow()]);
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Rejected,
        verifiedAt: new Date(),
        verifiedBy: 'admin',
        verifiedByAdminId: 'admin-1',
        rejectionReason: null,
      });

      await service.reviewProof(
        COMPLETION_ID,
        { status: VerificationStatus.Rejected } as { status: typeof VerificationStatus.Rejected },
        CTX,
      );
      const data = tx.completion.update.mock.calls[0][0].data;
      expect(data.rejectionReason).toBeNull();
    });

    it('throws NotFound when the completion does not exist', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.reviewProof(COMPLETION_ID, { status: VerificationStatus.Approved }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.completion.update).not.toHaveBeenCalled();
    });

    it('throws Conflict when the completion is no longer Pending', async () => {
      tx.$queryRaw.mockResolvedValue([
        lockedRow({ verificationStatus: VerificationStatus.Approved }),
      ]);
      await expect(
        service.reviewProof(COMPLETION_ID, { status: VerificationStatus.Approved }, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
