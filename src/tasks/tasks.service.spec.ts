import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ModerationTargetType,
  TaskSubmissionStatus,
  TaskVerificationMethod,
  UserTaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IdempotencyService, IdempotentRunParams } from '../idempotency/idempotency.service';
import { ReferralsService } from '../referrals/referrals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService } from '../moderation/reports.service';
import { TasksService } from './tasks.service';

const CREATOR = 'creator-1';
const ASSIGNEE = 'assignee-1';
const TASK_ID = 'task-1';

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    creatorId: CREATOR,
    assigneeId: null,
    title: 'Do the thing',
    description: null,
    rewardXp: null,
    verificationMethod: TaskVerificationMethod.NONE,
    evidenceRequired: false,
    status: UserTaskStatus.Open,
    inviteToken: null,
    dueAt: null,
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
    updatedAt: new Date('2026-07-14T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

interface Tx {
  userTask: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  userTaskSubmission: {
    create: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  userTaskAttachment: { create: jest.Mock };
  userTaskEvent: { create: jest.Mock };
  user: { update: jest.Mock };
  $queryRaw: jest.Mock;
}

describe('TasksService', () => {
  let service: TasksService;
  let tx: Tx;
  let prisma: {
    userTask: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
      count: jest.Mock;
    };
    userTaskSubmission: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: {
    buildTaskAttachmentKey: jest.Mock;
    uploadObject: jest.Mock;
    getSignedDownloadUrl: jest.Mock;
  };
  let idempotency: { run: jest.Mock };
  let referrals: { recordCompletionIfQualifying: jest.Mock };
  let notifications: { notify: jest.Mock };
  let reports: { filterHiddenTargetIds: jest.Mock };

  beforeEach(() => {
    tx = {
      userTask: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      userTaskSubmission: {
        create: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      userTaskAttachment: { create: jest.fn() },
      userTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn(),
    };
    prisma = {
      userTask: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      userTaskSubmission: { count: jest.fn() },
      $transaction: jest.fn(async (cb: (t: Tx) => Promise<unknown>) => cb(tx)),
    };
    storage = {
      buildTaskAttachmentKey: jest.fn().mockReturnValue('task-attachments/u/x.png'),
      uploadObject: jest.fn().mockResolvedValue(undefined),
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/x'),
    };
    // Idempotency wrapper is transparent in unit tests: run the operation.
    idempotency = {
      run: jest.fn((p: IdempotentRunParams<unknown>) => p.execute()),
    };
    referrals = {
      recordCompletionIfQualifying: jest.fn().mockResolvedValue(undefined),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    // Nothing hidden by default; the reporting integration is exercised
    // explicitly in the hide-filter tests below.
    reports = { filterHiddenTargetIds: jest.fn().mockResolvedValue(new Set<string>()) };
    service = new TasksService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      idempotency as unknown as IdempotencyService,
      referrals as unknown as ReferralsService,
      notifications as unknown as NotificationsService,
      reports as unknown as ReportsService,
    );
  });

  describe('createTask', () => {
    it('creates a task with defaults and records a created event', async () => {
      tx.userTask.create.mockResolvedValue(baseTask());
      const result = await service.createTask(CREATOR, { title: 'Do the thing' }, 'key');

      expect(tx.userTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            creatorId: CREATOR,
            verificationMethod: TaskVerificationMethod.NONE,
            evidenceRequired: false,
          }),
        }),
      );
      expect(tx.userTaskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'created' }) }),
      );
      expect(result.id).toBe(TASK_ID);
      expect(idempotency.run).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'POST /tasks', key: 'key' }),
      );
    });

    it('coerces dueAt string to a Date', async () => {
      tx.userTask.create.mockResolvedValue(baseTask());
      await service.createTask(CREATOR, { title: 'x', dueAt: '2026-07-20T00:00:00.000Z' });
      const arg = tx.userTask.create.mock.calls[0][0];
      expect(arg.data.dueAt).toBeInstanceOf(Date);
    });
  });

  describe('listTasks', () => {
    it('filters by creator role', async () => {
      prisma.userTask.findMany.mockResolvedValue([baseTask()]);
      await service.listTasks(CREATOR, { role: 'creator' });
      expect(prisma.userTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ creatorId: CREATOR }) }),
      );
    });

    it('filters by assignee role', async () => {
      prisma.userTask.findMany.mockResolvedValue([]);
      await service.listTasks(ASSIGNEE, { role: 'assignee' });
      expect(prisma.userTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assigneeId: ASSIGNEE }) }),
      );
    });

    it('defaults to an OR of creator/assignee and applies status filter', async () => {
      prisma.userTask.findMany.mockResolvedValue([]);
      await service.listTasks(CREATOR, { status: UserTaskStatus.Approved });
      const where = prisma.userTask.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ creatorId: CREATOR }, { assigneeId: CREATOR }]);
      expect(where.status).toBe(UserTaskStatus.Approved);
    });

    it('applies default pagination and returns the paginated envelope', async () => {
      prisma.userTask.findMany.mockResolvedValue([baseTask()]);
      prisma.userTask.count.mockResolvedValue(1);

      const res = await service.listTasks(CREATOR, {});

      expect(prisma.userTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 0 }),
      );
      expect(prisma.userTask.count).toHaveBeenCalledWith({
        where: prisma.userTask.findMany.mock.calls[0][0].where,
      });
      expect(res).toEqual(
        expect.objectContaining({ total: 1, limit: 20, offset: 0, items: expect.any(Array) }),
      );
      expect(res.items).toHaveLength(1);
    });

    it('honors an explicit limit/offset', async () => {
      prisma.userTask.findMany.mockResolvedValue([]);
      prisma.userTask.count.mockResolvedValue(0);

      await service.listTasks(CREATOR, { limit: 5, offset: 10 });

      expect(prisma.userTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 10 }),
      );
    });

    it('returns an empty page (not an error) when nothing matches', async () => {
      prisma.userTask.findMany.mockResolvedValue([]);
      prisma.userTask.count.mockResolvedValue(0);

      const res = await service.listTasks(CREATOR, {});

      expect(res).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    });
  });

  describe('getTask', () => {
    it('throws NotFound when missing', async () => {
      prisma.userTask.findUnique.mockResolvedValue(null);
      await expect(service.getTask(CREATOR, TASK_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden for a non-participant', async () => {
      prisma.userTask.findUnique.mockResolvedValue({ ...baseTask(), submissions: [] });
      await expect(service.getTask('stranger', TASK_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns detail and exposes inviteToken to the creator only', async () => {
      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask({ inviteToken: 'secret', assigneeId: ASSIGNEE }),
        submissions: [],
      });
      const asCreator = await service.getTask(CREATOR, TASK_ID);
      expect(asCreator.inviteToken).toBe('secret');

      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask({ inviteToken: 'secret', assigneeId: ASSIGNEE }),
        submissions: [],
      });
      const asAssignee = await service.getTask(ASSIGNEE, TASK_ID);
      expect(asAssignee.inviteToken).toBeNull();
    });

    it('signs attachment URLs in submission history', async () => {
      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask(),
        submissions: [
          {
            id: 'sub-1',
            submittedById: CREATOR,
            notes: null,
            status: TaskSubmissionStatus.Approved,
            submittedAt: new Date(),
            reviewedAt: null,
            reviewedById: null,
            rejectionReason: null,
            attachments: [{ id: 'att-1', kind: 'photo', objectKey: 'k', createdAt: new Date() }],
          },
        ],
      });
      const detail = await service.getTask(CREATOR, TASK_ID);
      expect(detail.submissions[0].attachments[0].url).toBe('https://signed.example/x');
    });

    it('omits a submission the viewer has reported from the inlined detail (P0 gap #6)', async () => {
      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask({ assigneeId: ASSIGNEE }),
        submissions: [
          {
            id: 'sub-hidden',
            submittedById: ASSIGNEE,
            notes: null,
            status: TaskSubmissionStatus.Submitted,
            submittedAt: new Date(),
            reviewedAt: null,
            reviewedById: null,
            rejectionReason: null,
            attachments: [],
          },
        ],
      });
      reports.filterHiddenTargetIds.mockResolvedValue(new Set(['sub-hidden']));

      const detail = await service.getTask(CREATOR, TASK_ID);

      expect(detail.submissions).toEqual([]);
    });
  });

  describe('updateTask', () => {
    it('throws NotFound when missing/deleted', async () => {
      prisma.userTask.findUnique.mockResolvedValue(null);
      await expect(service.updateTask(CREATOR, TASK_ID, { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Forbidden for a non-creator', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask());
      await expect(service.updateTask('other', TASK_ID, { title: 'x' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws Conflict once the task is past Invited', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask({ status: UserTaskStatus.Accepted }));
      await expect(service.updateTask(CREATOR, TASK_ID, { title: 'x' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('updates allowed fields while Open', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask());
      prisma.userTask.update.mockResolvedValue(baseTask({ title: 'New' }));
      const result = await service.updateTask(CREATOR, TASK_ID, { title: 'New', rewardXp: 10 });
      expect(prisma.userTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { title: 'New', rewardXp: 10 } }),
      );
      expect(result.title).toBe('New');
    });
  });

  describe('cancelTask', () => {
    it('throws Conflict when already Approved', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask({ status: UserTaskStatus.Approved }));
      await expect(service.cancelTask(CREATOR, TASK_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('soft-deletes and sets Cancelled', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask({ status: UserTaskStatus.Invited }));
      tx.userTask.update.mockResolvedValue(baseTask({ status: UserTaskStatus.Cancelled }));
      const result = await service.cancelTask(CREATOR, TASK_ID);
      expect(tx.userTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: UserTaskStatus.Cancelled,
            deletedAt: expect.any(Date),
          }),
        }),
      );
      expect(result.status).toBe(UserTaskStatus.Cancelled);
    });
  });

  describe('generateInvite', () => {
    it('throws Forbidden for a non-creator', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask());
      await expect(service.generateInvite('other', TASK_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws Conflict when the task already has an assignee', async () => {
      prisma.userTask.findUnique.mockResolvedValue(
        baseTask({ assigneeId: ASSIGNEE, status: UserTaskStatus.Accepted }),
      );
      await expect(service.generateInvite(CREATOR, TASK_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws Conflict from a non-invitable status', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask({ status: UserTaskStatus.Submitted }));
      await expect(service.generateInvite(CREATOR, TASK_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('generates a token, sets Invited, and returns a deep link', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask());
      tx.userTask.update.mockResolvedValue(baseTask({ status: UserTaskStatus.Invited }));
      const result = await service.generateInvite(CREATOR, TASK_ID);
      expect(result.inviteToken).toEqual(expect.any(String));
      expect(result.inviteUrl).toBe(`sidequest://tasks/invite/${result.inviteToken}`);
      expect(tx.userTaskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'invited' }) }),
      );
    });

    it('allows re-invite after a decline', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask({ status: UserTaskStatus.Declined }));
      tx.userTask.update.mockResolvedValue(baseTask({ status: UserTaskStatus.Invited }));
      await expect(service.generateInvite(CREATOR, TASK_ID)).resolves.toBeDefined();
    });
  });

  describe('acceptInvite', () => {
    it('throws NotFound for an unknown/cleared token', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.acceptInvite(ASSIGNEE, 'tok')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when the task already has an assignee', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: TASK_ID, creatorId: CREATOR, assigneeId: 'someone', status: UserTaskStatus.Accepted },
      ]);
      await expect(service.acceptInvite(ASSIGNEE, 'tok')).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict when the invite is no longer Invited', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: TASK_ID, creatorId: CREATOR, assigneeId: null, status: UserTaskStatus.Declined },
      ]);
      await expect(service.acceptInvite(ASSIGNEE, 'tok')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects the creator accepting their own invite', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: TASK_ID, creatorId: CREATOR, assigneeId: null, status: UserTaskStatus.Invited },
      ]);
      await expect(service.acceptInvite(CREATOR, 'tok')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('binds the assignee and sets Accepted', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: TASK_ID, creatorId: CREATOR, assigneeId: null, status: UserTaskStatus.Invited },
      ]);
      tx.userTask.update.mockResolvedValue(
        baseTask({ assigneeId: ASSIGNEE, status: UserTaskStatus.Accepted }),
      );
      const result = await service.acceptInvite(ASSIGNEE, 'tok', 'idem');
      expect(tx.userTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { assigneeId: ASSIGNEE, status: UserTaskStatus.Accepted },
        }),
      );
      expect(result.assigneeId).toBe(ASSIGNEE);
      expect(tx.userTaskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'accepted' }) }),
      );
      // M21.5 — exactly one notification per party: creator (task_accepted) and
      // assignee (task_assigned), both deep-linking to the task detail.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: CREATOR,
          type: 'task_accepted',
          data: { screen: 'task-detail', taskId: TASK_ID },
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ASSIGNEE, type: 'task_assigned' }),
      );
      expect(notifications.notify).toHaveBeenCalledTimes(2);
    });

    it('still accepts when the notification hook throws (isolation)', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: TASK_ID, creatorId: CREATOR, assigneeId: null, status: UserTaskStatus.Invited },
      ]);
      tx.userTask.update.mockResolvedValue(
        baseTask({ assigneeId: ASSIGNEE, status: UserTaskStatus.Accepted }),
      );
      notifications.notify.mockRejectedValue(new Error('redis down'));

      const result = await service.acceptInvite(ASSIGNEE, 'tok');

      expect(result.assigneeId).toBe(ASSIGNEE);
    });
  });

  describe('declineInvite', () => {
    it('throws NotFound for an unknown token', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.declineInvite(ASSIGNEE, 'tok')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Conflict when not Invited', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: TASK_ID, creatorId: CREATOR, assigneeId: null, status: UserTaskStatus.Accepted },
      ]);
      await expect(service.declineInvite(ASSIGNEE, 'tok')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('clears the token and sets Declined', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: TASK_ID, creatorId: CREATOR, assigneeId: null, status: UserTaskStatus.Invited },
      ]);
      tx.userTask.update.mockResolvedValue(baseTask({ status: UserTaskStatus.Declined }));
      await service.declineInvite(ASSIGNEE, 'tok');
      expect(tx.userTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: UserTaskStatus.Declined, inviteToken: null } }),
      );
      // M21.5 — the creator is notified their invite was declined.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CREATOR, type: 'task_declined' }),
      );
    });
  });

  describe('submitEvidence', () => {
    function stubTxLock(row: Record<string, unknown>) {
      tx.$queryRaw.mockResolvedValue([row]);
      tx.userTaskSubmission.count.mockResolvedValue(0);
      tx.userTaskSubmission.create.mockResolvedValue({ id: 'sub-1' });
      tx.userTask.update.mockResolvedValue({});
    }

    it('throws Forbidden when the caller is not the doer', async () => {
      prisma.userTask.findUnique.mockResolvedValue(
        baseTask({ assigneeId: ASSIGNEE, status: UserTaskStatus.Accepted }),
      );
      await expect(
        service.submitEvidence('stranger', TASK_ID, undefined, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a self-completion CREATOR_APPROVAL submission (Decision 2)', async () => {
      prisma.userTask.findUnique.mockResolvedValue(
        baseTask({ verificationMethod: TaskVerificationMethod.CREATOR_APPROVAL }),
      );
      await expect(service.submitEvidence(CREATOR, TASK_ID, undefined, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws Conflict from a non-submittable status', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask({ status: UserTaskStatus.Approved }));
      await expect(service.submitEvidence(CREATOR, TASK_ID, undefined, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws BadRequest when evidence is required but no file is attached', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask({ evidenceRequired: true }));
      await expect(service.submitEvidence(CREATOR, TASK_ID, undefined, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('auto-approves a NONE task and awards the reward to the doer', async () => {
      const task = baseTask({ rewardXp: 25 });
      prisma.userTask.findUnique
        .mockResolvedValueOnce(task) // findActiveTask
        .mockResolvedValueOnce({ ...task, status: UserTaskStatus.Approved, submissions: [] }); // reloadDetail
      stubTxLock({
        id: TASK_ID,
        creatorId: CREATOR,
        assigneeId: null,
        status: UserTaskStatus.Open,
        verificationMethod: TaskVerificationMethod.NONE,
        evidenceRequired: false,
        rewardXp: 25,
        deletedAt: null,
      });

      const detail = await service.submitEvidence(CREATOR, TASK_ID, undefined, { notes: 'done' });

      expect(tx.userTaskSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TaskSubmissionStatus.Approved }),
        }),
      );
      expect(tx.userTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: UserTaskStatus.Approved } }),
      );
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totalXp: { increment: 25 } } }),
      );
      expect(detail.status).toBe(UserTaskStatus.Approved);
      // An auto-resolved personal completion fires the referral hook (M20).
      expect(referrals.recordCompletionIfQualifying).toHaveBeenCalledWith(CREATOR);
      // Self-completion has no distinct counterparty — no notification (M21.5).
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('uploads an attachment and sets Submitted for a CREATOR_APPROVAL task', async () => {
      const task = baseTask({
        assigneeId: ASSIGNEE,
        status: UserTaskStatus.Accepted,
        verificationMethod: TaskVerificationMethod.CREATOR_APPROVAL,
      });
      prisma.userTask.findUnique
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce({ ...task, status: UserTaskStatus.Submitted, submissions: [] });
      tx.$queryRaw.mockResolvedValue([
        {
          id: TASK_ID,
          creatorId: CREATOR,
          assigneeId: ASSIGNEE,
          status: UserTaskStatus.Accepted,
          verificationMethod: TaskVerificationMethod.CREATOR_APPROVAL,
          evidenceRequired: false,
          rewardXp: null,
          deletedAt: null,
        },
      ]);
      tx.userTaskSubmission.count.mockResolvedValue(0);
      tx.userTaskSubmission.create.mockResolvedValue({ id: 'sub-1' });
      tx.userTask.update.mockResolvedValue({});

      const file = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;
      await service.submitEvidence(ASSIGNEE, TASK_ID, file, {});

      expect(storage.uploadObject).toHaveBeenCalled();
      expect(tx.userTaskAttachment.create).toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.userTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: UserTaskStatus.Submitted } }),
      );
      // M21.5 — awaiting review notifies the creator (task_submitted).
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CREATOR, type: 'task_submitted' }),
      );
    });

    it('records a resubmitted event when a prior submission exists', async () => {
      const task = baseTask({
        assigneeId: ASSIGNEE,
        status: UserTaskStatus.Rejected,
        verificationMethod: TaskVerificationMethod.CREATOR_APPROVAL,
      });
      prisma.userTask.findUnique
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce({ ...task, submissions: [] });
      tx.$queryRaw.mockResolvedValue([
        {
          id: TASK_ID,
          creatorId: CREATOR,
          assigneeId: ASSIGNEE,
          status: UserTaskStatus.Rejected,
          verificationMethod: TaskVerificationMethod.CREATOR_APPROVAL,
          evidenceRequired: false,
          rewardXp: null,
          deletedAt: null,
        },
      ]);
      tx.userTaskSubmission.count.mockResolvedValue(1);
      tx.userTaskSubmission.create.mockResolvedValue({ id: 'sub-2' });
      tx.userTask.update.mockResolvedValue({});

      await service.submitEvidence(ASSIGNEE, TASK_ID, undefined, {});
      expect(tx.userTaskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'resubmitted' }) }),
      );
    });

    it('throws NotFound if the locked row vanished/deleted inside the transaction', async () => {
      prisma.userTask.findUnique.mockResolvedValue(baseTask());
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.submitEvidence(CREATOR, TASK_ID, undefined, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listSubmissions', () => {
    it('throws NotFound when missing', async () => {
      prisma.userTask.findUnique.mockResolvedValue(null);
      await expect(service.listSubmissions(CREATOR, TASK_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Forbidden for a non-participant', async () => {
      prisma.userTask.findUnique.mockResolvedValue({ ...baseTask(), submissions: [] });
      await expect(service.listSubmissions('stranger', TASK_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns mapped submissions for a participant', async () => {
      prisma.userTask.findUnique.mockResolvedValue({ ...baseTask(), submissions: [] });
      const result = await service.listSubmissions(CREATOR, TASK_ID);
      expect(result).toEqual([]);
    });

    it('excludes submissions the viewer has reported (reporter-local / global hide, P0 gap #6)', async () => {
      const submission = (id: string) => ({
        id,
        submittedById: ASSIGNEE,
        notes: null,
        status: TaskSubmissionStatus.Submitted,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedById: null,
        rejectionReason: null,
        attachments: [],
      });
      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask({ assigneeId: ASSIGNEE }),
        submissions: [submission('sub-visible'), submission('sub-hidden')],
      });
      reports.filterHiddenTargetIds.mockResolvedValue(new Set(['sub-hidden']));

      const result = await service.listSubmissions(CREATOR, TASK_ID);

      expect(reports.filterHiddenTargetIds).toHaveBeenCalledWith(
        CREATOR,
        ModerationTargetType.UserTaskSubmission,
        ['sub-visible', 'sub-hidden'],
      );
      expect(result.map((s) => s.id)).toEqual(['sub-visible']);
    });
  });

  describe('reviewSubmission', () => {
    function lockRow(overrides: Record<string, unknown> = {}) {
      return {
        id: TASK_ID,
        creatorId: CREATOR,
        assigneeId: ASSIGNEE,
        status: UserTaskStatus.Submitted,
        verificationMethod: TaskVerificationMethod.CREATOR_APPROVAL,
        evidenceRequired: false,
        rewardXp: 40,
        deletedAt: null,
        ...overrides,
      };
    }

    it('throws NotFound when the task is missing', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.reviewSubmission(CREATOR, TASK_ID, 'sub-1', { decision: 'Approve' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden for a non-creator', async () => {
      tx.$queryRaw.mockResolvedValue([lockRow()]);
      await expect(
        service.reviewSubmission('other', TASK_ID, 'sub-1', { decision: 'Approve' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws BadRequest for a non-approval task', async () => {
      tx.$queryRaw.mockResolvedValue([
        lockRow({ verificationMethod: TaskVerificationMethod.SELF }),
      ]);
      await expect(
        service.reviewSubmission(CREATOR, TASK_ID, 'sub-1', { decision: 'Approve' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the submission does not belong to the task', async () => {
      tx.$queryRaw.mockResolvedValue([lockRow()]);
      tx.userTaskSubmission.findFirst.mockResolvedValue(null);
      await expect(
        service.reviewSubmission(CREATOR, TASK_ID, 'sub-1', { decision: 'Approve' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when the submission is already reviewed', async () => {
      tx.$queryRaw.mockResolvedValue([lockRow()]);
      tx.userTaskSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: TaskSubmissionStatus.Approved,
      });
      await expect(
        service.reviewSubmission(CREATOR, TASK_ID, 'sub-1', { decision: 'Approve' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('approves and awards the reward to the assignee', async () => {
      tx.$queryRaw.mockResolvedValue([lockRow()]);
      tx.userTaskSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: TaskSubmissionStatus.Submitted,
      });
      tx.userTaskSubmission.update.mockResolvedValue({});
      tx.userTask.update.mockResolvedValue({});
      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask({ status: UserTaskStatus.Approved }),
        submissions: [],
      });

      await service.reviewSubmission(CREATOR, TASK_ID, 'sub-1', { decision: 'Approve' });

      expect(tx.userTaskSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskSubmissionStatus.Approved,
            rejectionReason: null,
          }),
        }),
      );
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ASSIGNEE }, data: { totalXp: { increment: 40 } } }),
      );
      // The doer's approved completion fires the referral hook (M20).
      expect(referrals.recordCompletionIfQualifying).toHaveBeenCalledWith(ASSIGNEE);
      // M21.5 — the assignee is notified of the approval.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ASSIGNEE, type: 'task_approved' }),
      );
    });

    it('still approves when the referral hook throws (best-effort side effect)', async () => {
      tx.$queryRaw.mockResolvedValue([lockRow()]);
      tx.userTaskSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: TaskSubmissionStatus.Submitted,
      });
      tx.userTaskSubmission.update.mockResolvedValue({});
      tx.userTask.update.mockResolvedValue({});
      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask({ status: UserTaskStatus.Approved }),
        submissions: [],
      });
      referrals.recordCompletionIfQualifying.mockRejectedValue(new Error('referral db down'));

      const detail = await service.reviewSubmission(CREATOR, TASK_ID, 'sub-1', {
        decision: 'Approve',
      });

      expect(detail.status).toBe(UserTaskStatus.Approved);
    });

    it('rejects with the reason and does not award XP', async () => {
      tx.$queryRaw.mockResolvedValue([lockRow()]);
      tx.userTaskSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: TaskSubmissionStatus.Submitted,
      });
      tx.userTaskSubmission.update.mockResolvedValue({});
      tx.userTask.update.mockResolvedValue({});
      prisma.userTask.findUnique.mockResolvedValue({
        ...baseTask({ status: UserTaskStatus.Rejected }),
        submissions: [],
      });

      await service.reviewSubmission(CREATOR, TASK_ID, 'sub-1', {
        decision: 'Reject',
        rejectionReason: 'Blurry',
      });

      expect(tx.userTaskSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskSubmissionStatus.Rejected,
            rejectionReason: 'Blurry',
          }),
        }),
      );
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.userTaskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'rejected' }) }),
      );
      // A rejection is not a completion — the referral hook must not fire.
      expect(referrals.recordCompletionIfQualifying).not.toHaveBeenCalled();
      // M21.5 — the assignee is notified of the rejection.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ASSIGNEE, type: 'task_rejected' }),
      );
    });
  });

  describe('getSummary', () => {
    it('maps grouped counts into the created/assigned summary', async () => {
      prisma.userTask.groupBy
        .mockResolvedValueOnce([
          { status: UserTaskStatus.Open, _count: { _all: 2 } },
          { status: UserTaskStatus.Submitted, _count: { _all: 1 } },
          { status: UserTaskStatus.Approved, _count: { _all: 3 } },
        ])
        .mockResolvedValueOnce([
          { status: UserTaskStatus.Accepted, _count: { _all: 1 } },
          { status: UserTaskStatus.Rejected, _count: { _all: 2 } },
        ]);

      const summary = await service.getSummary(CREATOR);

      expect(summary.created).toEqual({
        total: 6,
        open: 2,
        invited: 0,
        awaitingMyReview: 1,
        approved: 3,
      });
      expect(summary.assigned).toEqual({
        total: 3,
        active: 1,
        awaitingReview: 0,
        needsResubmission: 2,
        approved: 0,
      });
    });
  });
});
