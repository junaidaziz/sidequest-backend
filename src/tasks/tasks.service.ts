import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  TaskSubmissionStatus,
  TaskVerificationMethod,
  UserTask,
  UserTaskStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ReferralsService } from '../referrals/referrals.service';
import { NotificationsService, NotifyParams } from '../notifications/notifications.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { SubmitTaskEvidenceDto } from './dto/submit-task-evidence.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import {
  PaginatedTasksDto,
  TaskDetailDto,
  TaskDto,
  TaskSubmissionDto,
} from './dto/task-response.dto';
import {
  AssignedTaskSummaryDto,
  CreatedTaskSummaryDto,
  TaskSummaryDto,
} from './dto/task-summary.dto';

/** Deep-link scheme the mobile app registers; embedded in a shared invite URL. */
const INVITE_URL_PREFIX = 'sidequest://tasks/invite/';

/** Default page size for GET /tasks, matching every other list endpoint's default. */
const DEFAULT_TASK_LIST_LIMIT = 20;

/** Statuses from which a doer may submit (or resubmit) evidence. */
const SUBMITTABLE_STATUSES: readonly UserTaskStatus[] = [
  UserTaskStatus.Open,
  UserTaskStatus.Accepted,
  UserTaskStatus.Rejected,
];

const taskWithSubmissions = Prisma.validator<Prisma.UserTaskDefaultArgs>()({
  include: {
    submissions: {
      orderBy: { submittedAt: 'asc' },
      include: { attachments: { orderBy: { createdAt: 'asc' } } },
    },
  },
});
type TaskWithSubmissions = Prisma.UserTaskGetPayload<typeof taskWithSubmissions>;

/** Minimal row shape returned by the `SELECT ... FOR UPDATE` task lock. */
interface LockedTaskRow {
  id: string;
  creatorId: string;
  assigneeId: string | null;
  status: UserTaskStatus;
  verificationMethod: TaskVerificationMethod;
  evidenceRequired: boolean;
  rewardXp: number | null;
  deletedAt: Date | null;
}

/**
 * Peer-to-peer user-created tasks (M19). Owns the full task lifecycle: creation,
 * personal-task self-completion, the link/token invite flow, and the
 * creator-approval review loop. All mutating entry points accept an optional
 * idempotency key (Decision 9) and route through IdempotencyService.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly idempotency: IdempotencyService,
    private readonly referrals: ReferralsService,
    private readonly notifications: NotificationsService,
  ) {}

  // --------------------------------------------------------------------------
  // M19.2 — Task CRUD + personal-task self-completion
  // --------------------------------------------------------------------------

  async createTask(userId: string, dto: CreateTaskDto, idempotencyKey?: string): Promise<TaskDto> {
    return this.idempotency.run({
      userId,
      key: idempotencyKey,
      endpoint: 'POST /tasks',
      execute: async () => {
        const task = await this.prisma.$transaction(async (tx) => {
          const created = await tx.userTask.create({
            data: {
              creatorId: userId,
              title: dto.title,
              description: dto.description ?? null,
              verificationMethod: dto.verificationMethod ?? TaskVerificationMethod.NONE,
              evidenceRequired: dto.evidenceRequired ?? false,
              rewardXp: dto.rewardXp ?? null,
              dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
            },
          });
          await this.recordEvent(tx, created.id, userId, 'created');
          return created;
        });
        this.logger.log(`Task ${task.id} created by ${userId}`);
        return this.mapTask(task);
      },
    });
  }

  async listTasks(userId: string, query: ListTasksQueryDto): Promise<PaginatedTasksDto> {
    const role = query.role ?? 'all';
    const roleWhere: Prisma.UserTaskWhereInput =
      role === 'creator'
        ? { creatorId: userId }
        : role === 'assignee'
          ? { assigneeId: userId }
          : { OR: [{ creatorId: userId }, { assigneeId: userId }] };

    const limit = query.limit ?? DEFAULT_TASK_LIST_LIMIT;
    const offset = query.offset ?? 0;
    const where: Prisma.UserTaskWhereInput = {
      deletedAt: null,
      ...roleWhere,
      ...(query.status ? { status: query.status } : {}),
    };

    const [tasks, total] = await Promise.all([
      this.prisma.userTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.userTask.count({ where }),
    ]);

    return { items: tasks.map((task) => this.mapTask(task)), total, limit, offset };
  }

  async getTask(userId: string, taskId: string): Promise<TaskDetailDto> {
    const task = await this.prisma.userTask.findUnique({
      where: { id: taskId },
      ...taskWithSubmissions,
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    this.assertParticipant(task, userId);
    return this.mapDetail(task, userId);
  }

  async updateTask(userId: string, taskId: string, dto: UpdateTaskDto): Promise<TaskDto> {
    const task = await this.findActiveTask(taskId);
    this.assertCreator(task, userId);
    // Decision 10: edits lock once the task is Accepted (or beyond).
    if (task.status !== UserTaskStatus.Open && task.status !== UserTaskStatus.Invited) {
      throw new ConflictException('Task can only be edited while Open or Invited');
    }
    const updated = await this.prisma.userTask.update({
      where: { id: taskId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.rewardXp !== undefined ? { rewardXp: dto.rewardXp } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
      },
    });
    return this.mapTask(updated);
  }

  async cancelTask(userId: string, taskId: string): Promise<TaskDto> {
    const task = await this.findActiveTask(taskId);
    this.assertCreator(task, userId);
    // Decision 10: cancel allowed any time before Approved.
    if (task.status === UserTaskStatus.Approved) {
      throw new ConflictException('An approved task cannot be cancelled');
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userTask.update({
        where: { id: taskId },
        data: { status: UserTaskStatus.Cancelled, deletedAt: new Date() },
      });
      await this.recordEvent(tx, taskId, userId, 'cancelled');
      return updated;
    });
    this.logger.log(`Task ${taskId} cancelled by ${userId}`);
    return this.mapTask(cancelled);
  }

  // --------------------------------------------------------------------------
  // M19.3 — Invite flow
  // --------------------------------------------------------------------------

  async generateInvite(userId: string, taskId: string): Promise<InviteResponseDto> {
    const task = await this.findActiveTask(taskId);
    this.assertCreator(task, userId);
    // "task must have no active assignee" — a bound assignee means the slot is
    // taken, so a second invite is a conflict (M19.3 acceptance: 409).
    if (task.assigneeId) {
      throw new ConflictException('Task already has an assignee');
    }
    if (
      task.status !== UserTaskStatus.Open &&
      task.status !== UserTaskStatus.Invited &&
      task.status !== UserTaskStatus.Declined
    ) {
      throw new ConflictException(`Cannot invite while task is ${task.status}`);
    }

    const inviteToken = randomBytes(24).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.userTask.update({
        where: { id: taskId },
        data: { inviteToken, status: UserTaskStatus.Invited },
      });
      await this.recordEvent(tx, taskId, userId, 'invited');
    });
    this.logger.log(`Invite generated for task ${taskId} by ${userId}`);
    return { inviteToken, inviteUrl: `${INVITE_URL_PREFIX}${inviteToken}` };
  }

  async acceptInvite(userId: string, token: string, idempotencyKey?: string): Promise<TaskDto> {
    return this.idempotency.run({
      userId,
      key: idempotencyKey,
      endpoint: `POST /tasks/invites/${token}/accept`,
      execute: async () => {
        const task = await this.prisma.$transaction(async (tx) => {
          const row = await this.lockTaskByToken(tx, token);
          if (!row) {
            throw new NotFoundException('Invite not found or no longer valid');
          }
          // A bound assignee means someone already accepted — reject the second
          // acceptance (M19.3 acceptance: 409).
          if (row.assigneeId) {
            throw new ConflictException('Task already has an assignee');
          }
          if (row.status !== UserTaskStatus.Invited) {
            throw new ConflictException(`Invite is no longer open (task is ${row.status})`);
          }
          if (row.creatorId === userId) {
            throw new BadRequestException('You cannot accept your own task invite');
          }
          const updated = await tx.userTask.update({
            where: { id: row.id },
            data: { assigneeId: userId, status: UserTaskStatus.Accepted },
          });
          await this.recordEvent(tx, row.id, userId, 'accepted');
          return updated;
        });
        this.logger.log(`Task ${task.id} accepted by ${userId}`);
        // M21.5 — exactly one notification per party (M21.5 acceptance): the
        // creator learns their task was accepted, and the newly-bound assignee
        // gets their entry point into the task. Both deep-link to the detail.
        const deepLink = { screen: 'task-detail', taskId: task.id };
        await this.fireNotification({
          userId: task.creatorId,
          type: NotificationType.task_accepted,
          title: 'Task accepted',
          body: `Your task "${task.title}" was accepted.`,
          data: deepLink,
        });
        if (task.assigneeId) {
          await this.fireNotification({
            userId: task.assigneeId,
            type: NotificationType.task_assigned,
            title: 'Task assigned',
            body: `You accepted the task "${task.title}".`,
            data: deepLink,
          });
        }
        return this.mapTask(task);
      },
    });
  }

  async declineInvite(userId: string, token: string, idempotencyKey?: string): Promise<TaskDto> {
    return this.idempotency.run({
      userId,
      key: idempotencyKey,
      endpoint: `POST /tasks/invites/${token}/decline`,
      execute: async () => {
        const task = await this.prisma.$transaction(async (tx) => {
          const row = await this.lockTaskByToken(tx, token);
          if (!row) {
            throw new NotFoundException('Invite not found or no longer valid');
          }
          if (row.status !== UserTaskStatus.Invited) {
            throw new ConflictException(`Invite is no longer open (task is ${row.status})`);
          }
          // Clear the token so a declined invite can never silently re-bind
          // (M19.3 acceptance). The creator must generate a fresh invite to retry.
          const updated = await tx.userTask.update({
            where: { id: row.id },
            data: { status: UserTaskStatus.Declined, inviteToken: null },
          });
          await this.recordEvent(tx, row.id, userId, 'declined');
          return updated;
        });
        this.logger.log(`Task ${task.id} invite declined by ${userId}`);
        // M21.5 — notify the creator that their invite was declined.
        await this.fireNotification({
          userId: task.creatorId,
          type: NotificationType.task_declined,
          title: 'Invite declined',
          body: `Your invite for "${task.title}" was declined.`,
          data: { screen: 'task-detail', taskId: task.id },
        });
        return this.mapTask(task);
      },
    });
  }

  // --------------------------------------------------------------------------
  // M19.2 / M19.4 — Evidence submission + creator-approval review
  // --------------------------------------------------------------------------

  async submitEvidence(
    userId: string,
    taskId: string,
    file: Express.Multer.File | undefined,
    dto: SubmitTaskEvidenceDto,
    idempotencyKey?: string,
  ): Promise<TaskDetailDto> {
    return this.idempotency.run({
      userId,
      key: idempotencyKey,
      endpoint: `POST /tasks/${taskId}/submissions`,
      execute: () => this.doSubmitEvidence(userId, taskId, file, dto),
    });
  }

  private async doSubmitEvidence(
    userId: string,
    taskId: string,
    file: Express.Multer.File | undefined,
    dto: SubmitTaskEvidenceDto,
  ): Promise<TaskDetailDto> {
    const task = await this.findActiveTask(taskId);

    // The "doer" is the assignee on a shared task, or the creator on a personal
    // (assignee-less) task. Only the doer may submit evidence.
    const doerId = task.assigneeId ?? task.creatorId;
    if (userId !== doerId) {
      throw new ForbiddenException('Only the task doer can submit evidence');
    }

    // Decision 2: a self-completion (assignee-less) CREATOR_APPROVAL submission
    // is disallowed — there is no distinct reviewer, so it can never resolve.
    if (
      task.verificationMethod === TaskVerificationMethod.CREATOR_APPROVAL &&
      task.assigneeId === null
    ) {
      throw new BadRequestException('CREATOR_APPROVAL requires an assignee');
    }

    if (!SUBMITTABLE_STATUSES.includes(task.status)) {
      throw new ConflictException(`Cannot submit evidence while task is ${task.status}`);
    }
    if (task.evidenceRequired && !file) {
      throw new BadRequestException('This task requires an evidence attachment');
    }

    // Upload outside the transaction (mirrors ProofService): a committed row must
    // not depend on S3 latency, and buildTaskAttachmentKey rejects bad MIME (400).
    let attachmentKey: string | null = null;
    if (file) {
      attachmentKey = this.storage.buildTaskAttachmentKey(userId, file.mimetype);
      await this.storage.uploadObject(attachmentKey, file.buffer, file.mimetype);
    }

    const isAutoResolved =
      task.verificationMethod === TaskVerificationMethod.NONE ||
      task.verificationMethod === TaskVerificationMethod.SELF;

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTaskById(tx, taskId);
      if (!locked || locked.deletedAt) {
        throw new NotFoundException('Task not found');
      }
      if (!SUBMITTABLE_STATUSES.includes(locked.status)) {
        throw new ConflictException(`Cannot submit evidence while task is ${locked.status}`);
      }

      const priorCount = await tx.userTaskSubmission.count({ where: { taskId } });
      const submission = await tx.userTaskSubmission.create({
        data: {
          taskId,
          submittedById: userId,
          notes: dto.notes ?? null,
          status: isAutoResolved ? TaskSubmissionStatus.Approved : TaskSubmissionStatus.Submitted,
          reviewedAt: isAutoResolved ? new Date() : null,
          reviewedById: isAutoResolved ? userId : null,
        },
      });
      if (attachmentKey) {
        await tx.userTaskAttachment.create({
          data: { submissionId: submission.id, kind: 'photo', objectKey: attachmentKey },
        });
      }

      await this.recordEvent(tx, taskId, userId, priorCount > 0 ? 'resubmitted' : 'submitted');

      if (isAutoResolved) {
        await tx.userTask.update({
          where: { id: taskId },
          data: { status: UserTaskStatus.Approved },
        });
        await this.awardReward(tx, doerId, locked.rewardXp);
        await this.recordEvent(tx, taskId, userId, 'approved');
      } else {
        await tx.userTask.update({
          where: { id: taskId },
          data: { status: UserTaskStatus.Submitted },
        });
      }
    });

    // An auto-resolved submission approves the task immediately, so the doer's
    // completion may qualify a referral reward (M20).
    if (isAutoResolved) {
      await this.fireReferralCompletionHook(doerId);
    } else {
      // M21.5 — CREATOR_APPROVAL evidence is awaiting the creator's review;
      // notify them. (Auto-resolved NONE/SELF submissions have no distinct
      // reviewer — the doer is acting on their own task — so no notification.)
      await this.fireNotification({
        userId: task.creatorId,
        type: NotificationType.task_submitted,
        title: 'Evidence submitted',
        body: `Evidence was submitted for your task "${task.title}".`,
        data: { screen: 'task-detail', taskId },
      });
    }

    this.logger.log(
      `Evidence submitted for task ${taskId} by ${userId} ` +
        `(${isAutoResolved ? 'auto-approved' : 'awaiting review'})`,
    );
    return this.reloadDetail(taskId, userId);
  }

  async listSubmissions(userId: string, taskId: string): Promise<TaskSubmissionDto[]> {
    const task = await this.prisma.userTask.findUnique({
      where: { id: taskId },
      ...taskWithSubmissions,
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    this.assertParticipant(task, userId);
    return Promise.all(task.submissions.map((s) => this.mapSubmission(s)));
  }

  async reviewSubmission(
    userId: string,
    taskId: string,
    submissionId: string,
    dto: ReviewSubmissionDto,
    idempotencyKey?: string,
  ): Promise<TaskDetailDto> {
    return this.idempotency.run({
      userId,
      key: idempotencyKey,
      endpoint: `PATCH /tasks/${taskId}/submissions/${submissionId}/review`,
      execute: () => this.doReviewSubmission(userId, taskId, submissionId, dto),
    });
  }

  private async doReviewSubmission(
    userId: string,
    taskId: string,
    submissionId: string,
    dto: ReviewSubmissionDto,
  ): Promise<TaskDetailDto> {
    // Set to the doer's id when this review approves the task, so the referral
    // completion hook can fire after the transaction commits (M20).
    let approvedDoerId: string | null = null;
    // The doer to notify (assignee on a CREATOR_APPROVAL task) and the outcome,
    // captured in-tx so the M21.5 notification fires exactly once, post-commit.
    let reviewedDoerId: string | null = null;
    let reviewOutcome: 'Approve' | 'Reject' | null = null;
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTaskById(tx, taskId);
      if (!locked || locked.deletedAt) {
        throw new NotFoundException('Task not found');
      }
      // Only the creator reviews, and only CREATOR_APPROVAL tasks are reviewable.
      if (locked.creatorId !== userId) {
        throw new ForbiddenException('Only the task creator can review submissions');
      }
      if (locked.verificationMethod !== TaskVerificationMethod.CREATOR_APPROVAL) {
        throw new BadRequestException('This task does not use creator approval');
      }

      const submission = await tx.userTaskSubmission.findFirst({
        where: { id: submissionId, taskId },
      });
      if (!submission) {
        throw new NotFoundException('Submission not found');
      }
      if (submission.status !== TaskSubmissionStatus.Submitted) {
        throw new ConflictException(`Submission is already ${submission.status}`);
      }

      const isApprove = dto.decision === 'Approve';
      await tx.userTaskSubmission.update({
        where: { id: submissionId },
        data: {
          status: isApprove ? TaskSubmissionStatus.Approved : TaskSubmissionStatus.Rejected,
          reviewedAt: new Date(),
          reviewedById: userId,
          // rejectionReason is enforced by the DTO on Reject; ignored on Approve.
          rejectionReason: isApprove ? null : (dto.rejectionReason ?? null),
        },
      });
      await tx.userTask.update({
        where: { id: taskId },
        data: { status: isApprove ? UserTaskStatus.Approved : UserTaskStatus.Rejected },
      });

      const doerId = locked.assigneeId ?? locked.creatorId;
      reviewedDoerId = doerId;
      if (isApprove) {
        // Reward goes to the doer (the assignee on a creator-approval task).
        await this.awardReward(tx, doerId, locked.rewardXp);
        await this.recordEvent(tx, taskId, userId, 'approved');
        approvedDoerId = doerId;
        reviewOutcome = 'Approve';
      } else {
        await this.recordEvent(tx, taskId, userId, 'rejected');
        reviewOutcome = 'Reject';
      }
    });

    // The doer's approved completion may qualify a referral reward (M20).
    if (approvedDoerId) {
      await this.fireReferralCompletionHook(approvedDoerId);
    }

    const detail = await this.reloadDetail(taskId, userId);

    // M21.5 — notify the doer of the review outcome (approve/reject). The doer
    // is the assignee (self-completion CREATOR_APPROVAL is blocked), so this is
    // always a distinct counterparty from the reviewing creator.
    if (reviewedDoerId && reviewOutcome) {
      const approved = reviewOutcome === 'Approve';
      await this.fireNotification({
        userId: reviewedDoerId,
        type: approved ? NotificationType.task_approved : NotificationType.task_rejected,
        title: approved ? 'Task approved' : 'Task rejected',
        body: approved
          ? `Your submission for "${detail.title}" was approved.`
          : `Your submission for "${detail.title}" was rejected.`,
        data: { screen: 'task-detail', taskId },
      });
    }

    this.logger.log(
      `Submission ${submissionId} on task ${taskId} ${dto.decision === 'Approve' ? 'approved' : 'rejected'} by ${userId}`,
    );
    return detail;
  }

  // --------------------------------------------------------------------------
  // M19.6 — Summary
  // --------------------------------------------------------------------------

  async getSummary(userId: string): Promise<TaskSummaryDto> {
    const [createdGroups, assignedGroups] = await Promise.all([
      this.prisma.userTask.groupBy({
        by: ['status'],
        where: { creatorId: userId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.userTask.groupBy({
        by: ['status'],
        where: { assigneeId: userId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const createdCounts = this.toStatusCounts(createdGroups);
    const assignedCounts = this.toStatusCounts(assignedGroups);

    const created: CreatedTaskSummaryDto = {
      total: sum(createdCounts),
      open: createdCounts[UserTaskStatus.Open] ?? 0,
      invited: createdCounts[UserTaskStatus.Invited] ?? 0,
      awaitingMyReview: createdCounts[UserTaskStatus.Submitted] ?? 0,
      approved: createdCounts[UserTaskStatus.Approved] ?? 0,
    };
    const assigned: AssignedTaskSummaryDto = {
      total: sum(assignedCounts),
      active: assignedCounts[UserTaskStatus.Accepted] ?? 0,
      awaitingReview: assignedCounts[UserTaskStatus.Submitted] ?? 0,
      needsResubmission: assignedCounts[UserTaskStatus.Rejected] ?? 0,
      approved: assignedCounts[UserTaskStatus.Approved] ?? 0,
    };
    return { created, assigned };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private toStatusCounts(
    groups: { status: UserTaskStatus; _count: { _all: number } }[],
  ): Partial<Record<UserTaskStatus, number>> {
    const out: Partial<Record<UserTaskStatus, number>> = {};
    for (const g of groups) {
      out[g.status] = g._count._all;
    }
    return out;
  }

  private async findActiveTask(taskId: string): Promise<UserTask> {
    const task = await this.prisma.userTask.findUnique({ where: { id: taskId } });
    if (!task || task.deletedAt) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  /**
   * Best-effort referral completion hook (M20). Runs after the approval
   * transaction has committed so a referral-side failure can never undo an
   * already-approved task or reverse its XP — mirrors ProofService's
   * try/catch-and-log around the same hook.
   */
  private async fireReferralCompletionHook(doerId: string): Promise<void> {
    try {
      await this.referrals.recordCompletionIfQualifying(doerId);
    } catch (error) {
      this.logger.error(
        `Referral completion hook failed for user ${doerId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Best-effort notification hook (M21.5). Wrapped in its own try/catch-and-log
   * so a notification failure can never break the task operation it is attached
   * to — the same isolation the referral completion hook above uses, and the
   * pattern M20's review mandated after an un-isolated cross-module call could
   * 500 an already-committed operation.
   */
  private async fireNotification(params: NotifyParams): Promise<void> {
    try {
      await this.notifications.notify(params);
    } catch (error) {
      this.logger.error(
        `Notification hook failed for user ${params.userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private assertCreator(task: UserTask, userId: string): void {
    if (task.creatorId !== userId) {
      throw new ForbiddenException('Only the task creator can perform this action');
    }
  }

  private assertParticipant(task: UserTask, userId: string): void {
    if (task.creatorId !== userId && task.assigneeId !== userId) {
      throw new ForbiddenException('You are not a participant in this task');
    }
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    taskId: string,
    actorId: string,
    type: string,
  ): Promise<void> {
    await tx.userTaskEvent.create({ data: { taskId, actorId, type } });
  }

  /** Atomic, clamped XP grant to the doer. No-op when there is no reward. */
  private async awardReward(
    tx: Prisma.TransactionClient,
    userId: string,
    rewardXp: number | null,
  ): Promise<void> {
    if (rewardXp && rewardXp > 0) {
      await tx.user.update({
        where: { id: userId },
        data: { totalXp: { increment: rewardXp } },
      });
    }
  }

  private async lockTaskById(
    tx: Prisma.TransactionClient,
    taskId: string,
  ): Promise<LockedTaskRow | undefined> {
    const rows = await tx.$queryRaw<LockedTaskRow[]>`
      SELECT id, "creatorId", "assigneeId", status, "verificationMethod",
             "evidenceRequired", "rewardXp", "deletedAt"
      FROM "UserTask"
      WHERE id = ${taskId}
      FOR UPDATE`;
    return rows[0];
  }

  private async lockTaskByToken(
    tx: Prisma.TransactionClient,
    token: string,
  ): Promise<LockedTaskRow | undefined> {
    const rows = await tx.$queryRaw<LockedTaskRow[]>`
      SELECT id, "creatorId", "assigneeId", status, "verificationMethod",
             "evidenceRequired", "rewardXp", "deletedAt"
      FROM "UserTask"
      WHERE "inviteToken" = ${token}
      FOR UPDATE`;
    return rows[0];
  }

  private async reloadDetail(taskId: string, viewerId: string): Promise<TaskDetailDto> {
    const task = await this.prisma.userTask.findUnique({
      where: { id: taskId },
      ...taskWithSubmissions,
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return this.mapDetail(task, viewerId);
  }

  private mapTask(task: UserTask): TaskDto {
    return {
      id: task.id,
      creatorId: task.creatorId,
      assigneeId: task.assigneeId,
      title: task.title,
      description: task.description,
      rewardXp: task.rewardXp,
      verificationMethod: task.verificationMethod,
      evidenceRequired: task.evidenceRequired,
      status: task.status,
      dueAt: task.dueAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private async mapDetail(task: TaskWithSubmissions, viewerId: string): Promise<TaskDetailDto> {
    const submissions = await Promise.all(task.submissions.map((s) => this.mapSubmission(s)));
    return {
      ...this.mapTask(task),
      // Only the creator sees the raw invite token.
      inviteToken: task.creatorId === viewerId ? task.inviteToken : null,
      submissions,
    };
  }

  private async mapSubmission(
    submission: TaskWithSubmissions['submissions'][number],
  ): Promise<TaskSubmissionDto> {
    const attachments = await Promise.all(
      submission.attachments.map(async (a) => ({
        id: a.id,
        kind: a.kind,
        url: await this.signAttachment(a.objectKey),
        createdAt: a.createdAt,
      })),
    );
    return {
      id: submission.id,
      submittedById: submission.submittedById,
      notes: submission.notes,
      status: submission.status,
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt,
      reviewedById: submission.reviewedById,
      rejectionReason: submission.rejectionReason,
      attachments,
    };
  }

  /**
   * Resolves an attachment key to a presigned URL, degrading to null on failure.
   * A null key means the attachment was de-referenced by the submitter's account
   * deletion (M22.2) — there is no media to sign, so return null directly.
   */
  private async signAttachment(objectKey: string | null): Promise<string | null> {
    if (!objectKey) {
      return null;
    }
    try {
      return await this.storage.getSignedDownloadUrl(objectKey);
    } catch (error) {
      this.logger.error(
        `Failed to sign attachment ${objectKey}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }
}

/** Sums the values of a partial status-count map. */
function sum(counts: Partial<Record<UserTaskStatus, number>>): number {
  return Object.values(counts).reduce<number>((acc, n) => acc + (n ?? 0), 0);
}
