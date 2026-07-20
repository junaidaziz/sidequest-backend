import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ModerationActionType,
  ModerationTargetType,
  Prisma,
  ReportStatus,
  VerificationStatus,
} from '@prisma/client';
import { AdminUsersService } from '../admin/admin-users.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { PermissionResolverService } from '../rbac/permission-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateModerationActionDto } from './dto/create-moderation-action.dto';
import { DecideAppealDto } from './dto/decide-appeal.dto';
import { ListAppealsQueryDto } from './dto/list-appeals-query.dto';
import { ListModerationActionsQueryDto } from './dto/list-moderation-actions-query.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ModerationQueueQueryDto } from './dto/moderation-queue-query.dto';
import {
  AppealListItemDto,
  AppealPageDto,
  ModerationActionPageDto,
  ModerationActionSummaryDto,
  ModerationQueueItemDto,
  ModerationQueuePageDto,
  ProofReviewResponseDto,
  ReportDetailDto,
  ReportListItemDto,
  ReportPageDto,
} from './dto/moderation-response.dto';
import { ReviewProofDto } from './dto/review-proof.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import {
  CONTENT_DIRECTED_ACTIONS,
  ModerationActionContext,
  ModerationQueueSource,
  USER_DIRECTED_ACTIONS,
} from './types/moderation';

/** Free-text identity written to Completion.verifiedBy for a manual admin override. */
const PROOF_VERIFIER = 'admin';
/** Permission that additionally gates content-hiding/removal action types. */
const REMOVE_CONTENT_PERMISSION = 'moderation.remove_content';

interface LockedCompletionRow {
  id: string;
  userId: string;
  xpAwarded: number;
  verificationStatus: VerificationStatus;
}

/** Intermediate queue row carrying the raw S3 key, before presigning the sliced page. */
interface RawQueueItem extends Omit<ModerationQueueItemDto, 'proofUrl'> {
  proofKey: string | null;
}

/**
 * Admin-side moderation (Phase 10): the unified proof/submission review queue plus
 * the Report / ModerationAction / Appeal workflow, and the RBAC-gated proof-review
 * route that replaces the legacy shared-key `AdminGuard` completion route.
 *
 * Reuse, not duplication:
 *  - Suspension/ban applies the *exact* Phase 8 `AdminUsersService.suspend` (which
 *    nulls `refreshTokenHash` and is what `JwtStrategy` checks on every request) —
 *    never a second, parallel suspension flag.
 *  - Un-suspend on an upheld appeal applies the Phase 8 `AdminUsersService.reactivate`.
 *  - `reviewProof` reproduces the legacy `AdminService.updateVerification` logic
 *    byte-for-byte (SELECT ... FOR UPDATE, 409-if-not-Pending, atomic
 *    GREATEST(0, totalXp - xpAwarded) reversal on reject) and additionally sets the
 *    real `verifiedByAdminId` FK while keeping the free-text `verifiedBy = 'admin'`.
 *
 * The queue is a read-only aggregation over existing `Completion` /
 * `UserTaskSubmission` rows — it introduces no new data model and never mutates the
 * user-facing submission flows.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly storage: StorageService,
    private readonly resolver: PermissionResolverService,
    private readonly adminUsers: AdminUsersService,
  ) {}

  // --- Unified queue -------------------------------------------------------

  /**
   * Merged, paginated view of pending `Completion` proofs and pending
   * `UserTaskSubmission` evidence. Because the two live in separate tables, each is
   * fetched up to the requested page boundary, merged, ordered by submission time
   * desc, and sliced — so a single page is a correct interleave of both sources.
   */
  async getQueue(query: ModerationQueueQueryDto): Promise<ModerationQueuePageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const includeCompletions = !query.source || query.source === ModerationQueueSource.Completion;
    const includeSubmissions =
      !query.source || query.source === ModerationQueueSource.TaskSubmission;
    const upTo = page * pageSize;

    const [pendingCompletions, pendingTaskSubmissions] = await Promise.all([
      includeCompletions
        ? this.prisma.completion.count({
            where: { verificationStatus: VerificationStatus.Pending },
          })
        : Promise.resolve(0),
      includeSubmissions
        ? this.prisma.userTaskSubmission.count({ where: { status: 'Submitted' } })
        : Promise.resolve(0),
    ]);

    const [completions, submissions] = await Promise.all([
      includeCompletions
        ? this.prisma.completion.findMany({
            where: { verificationStatus: VerificationStatus.Pending },
            orderBy: { completedAt: 'desc' },
            take: upTo,
            include: {
              mission: { select: { title: true } },
              user: { select: { displayName: true } },
            },
          })
        : Promise.resolve([]),
      includeSubmissions
        ? this.prisma.userTaskSubmission.findMany({
            where: { status: 'Submitted' },
            orderBy: { submittedAt: 'desc' },
            take: upTo,
            include: {
              task: { select: { title: true } },
              submittedBy: { select: { displayName: true } },
              attachments: { where: { objectKey: { not: null } }, take: 1 },
            },
          })
        : Promise.resolve([]),
    ]);

    const merged: RawQueueItem[] = [
      ...completions.map((c): RawQueueItem => ({
        source: ModerationQueueSource.Completion,
        id: c.id,
        targetType: ModerationTargetType.Completion,
        submittedById: c.userId,
        submitterDisplayName: c.user.displayName,
        title: c.mission.title,
        status: c.verificationStatus,
        proofType: c.proofType,
        proofText: c.proofText,
        proofKey: c.proofKey,
        xpAwarded: c.xpAwarded,
        submittedAt: c.completedAt,
      })),
      ...submissions.map((s): RawQueueItem => ({
        source: ModerationQueueSource.TaskSubmission,
        id: s.id,
        targetType: ModerationTargetType.UserTaskSubmission,
        submittedById: s.submittedById,
        submitterDisplayName: s.submittedBy.displayName,
        title: s.task.title,
        status: s.status,
        proofType: null,
        proofText: s.notes,
        proofKey: s.attachments[0]?.objectKey ?? null,
        xpAwarded: null,
        submittedAt: s.submittedAt,
      })),
    ]
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    // Presign media only for the returned page, not every fetched row.
    const items = await Promise.all(
      merged.map(async ({ proofKey, ...rest }): Promise<ModerationQueueItemDto> => {
        return {
          ...rest,
          proofUrl: proofKey ? await this.storage.getSignedDownloadUrl(proofKey) : null,
        };
      }),
    );

    return {
      items,
      total: pendingCompletions + pendingTaskSubmissions,
      pendingCompletions,
      pendingTaskSubmissions,
      page,
      pageSize,
    };
  }

  // --- Reports -------------------------------------------------------------

  /** Paginated, filtered report list. Soft-deleted reports are always excluded. */
  async listReports(query: ListReportsQueryDto): Promise<ReportPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.ReportWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.targetType) where.targetType = query.targetType;
    if (query.reason) where.reason = { contains: query.reason, mode: 'insensitive' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.report.count({ where }),
    ]);

    return { items: rows.map((r) => this.toReportListItem(r)), total, page, pageSize };
  }

  /** Full report view with its moderation actions. */
  async getReport(id: string): Promise<ReportDetailDto> {
    const report = await this.prisma.report.findFirst({
      where: { id, deletedAt: null },
      include: { actions: { orderBy: { createdAt: 'desc' } } },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return {
      ...this.toReportListItem(report),
      resolutionNote: report.resolutionNote,
      actions: report.actions.map((a) => this.toActionSummary(a)),
    };
  }

  /**
   * Transitions a report's triage status (Open -> UnderReview -> Resolved/Dismissed).
   * Resolved and Dismissed are terminal — a further transition is a 409.
   */
  async updateReport(
    id: string,
    dto: UpdateReportDto,
    ctx: ModerationActionContext,
  ): Promise<ReportDetailDto> {
    const report = await this.prisma.report.findFirst({ where: { id, deletedAt: null } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (report.status === ReportStatus.Resolved || report.status === ReportStatus.Dismissed) {
      throw new ConflictException(`Report is already ${report.status} and cannot be changed`);
    }

    const terminal = dto.status === ReportStatus.Resolved || dto.status === ReportStatus.Dismissed;
    await this.prisma.report.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionNote: dto.resolutionNote ?? report.resolutionNote,
        // Stamp the reviewer once the report reaches a terminal decision (or when it
        // first enters review), so the audit trail records who resolved it.
        reviewedByAdminId: terminal ? ctx.actorAdminUserId : report.reviewedByAdminId,
        reviewedAt: terminal ? new Date() : report.reviewedAt,
      },
    });

    await this.recordAudit('moderation.manage_reports', 'Report', id, ctx, {
      previous: { status: report.status },
      next: { status: dto.status },
      reason: dto.resolutionNote ?? null,
    });
    this.logger.log(
      `Report ${id} transitioned ${report.status} -> ${dto.status} by admin ${ctx.actorAdminUserId}`,
    );
    return this.getReport(id);
  }

  // --- Moderation actions --------------------------------------------------

  /**
   * Records a `ModerationAction` linked to a report and applies its side effect.
   * User-directed suspend/ban reuse the Phase 8 suspend mechanism; reinstate reuses
   * reactivate. Content-directed types additionally require `moderation.remove_content`.
   *
   * The user-state side effect and the `ModerationAction` row are written inside one
   * `prisma.$transaction` so they commit or roll back together — otherwise a failure
   * on the `moderationAction.create` after a successful suspend would leave the user
   * suspended with no record of why (backend-eval D3-FAIL-1, Phase 10 cutover review).
   */
  async createAction(
    reportId: string,
    dto: CreateModerationActionDto,
    ctx: ModerationActionContext,
  ): Promise<ModerationActionSummaryDto> {
    const report = await this.prisma.report.findFirst({ where: { id: reportId, deletedAt: null } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const isUserDirected = USER_DIRECTED_ACTIONS.includes(dto.actionType);
    const isContentDirected = CONTENT_DIRECTED_ACTIONS.includes(dto.actionType);

    if (isContentDirected) {
      const allowed = await this.resolver.hasAll(ctx.actorAdminUserId, [REMOVE_CONTENT_PERMISSION]);
      if (!allowed) {
        throw new ForbiddenException(`Missing required permission: ${REMOVE_CONTENT_PERMISSION}`);
      }
    }

    const targetUserId = dto.targetUserId ?? (await this.resolveReportTargetUser(report));
    if (isUserDirected && !targetUserId) {
      throw new BadRequestException(
        'No target user could be resolved for this report; supply targetUserId',
      );
    }

    const action = await this.prisma.$transaction(async (tx) => {
      // Apply the user-state side effect BEFORE recording the action, reusing the
      // exact Phase 8 mechanism. Suspension is idempotent here: an already-suspended
      // user is left as-is (a Ban recorded over an existing Suspension does not
      // double-suspend). Same `tx` as the moderationAction.create below.
      if (targetUserId && isUserDirected) {
        await this.applyUserAction(dto.actionType, targetUserId, dto.reason, ctx, tx);
      }

      return tx.moderationAction.create({
        data: {
          reportId: report.id,
          adminUserId: ctx.actorAdminUserId,
          actionType: dto.actionType,
          targetType: report.targetType,
          targetId: report.targetId,
          targetUserId: targetUserId ?? null,
          reason: dto.reason,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
    });

    await this.recordAudit(
      isContentDirected ? 'moderation.remove_content' : 'moderation.take_action',
      report.targetType,
      report.targetId,
      ctx,
      {
        previous: null,
        next: { actionType: dto.actionType, targetUserId, moderationActionId: action.id },
        reason: dto.reason,
      },
    );
    this.logger.log(
      `Moderation action ${dto.actionType} recorded for report ${reportId} by admin ${ctx.actorAdminUserId}`,
    );
    return this.toActionSummary(action);
  }

  /** Paginated, filtered moderation-action history (read-only). */
  async listActions(query: ListModerationActionsQueryDto): Promise<ModerationActionPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.ModerationActionWhereInput = {};
    if (query.actionType) where.actionType = query.actionType;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetUserId) where.targetUserId = query.targetUserId;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.moderationAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.moderationAction.count({ where }),
    ]);

    return { items: rows.map((a) => this.toActionSummary(a)), total, page, pageSize };
  }

  // --- Appeals -------------------------------------------------------------

  /** Paginated, filtered appeal list, each with its underlying action embedded. */
  async listAppeals(query: ListAppealsQueryDto): Promise<AppealPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.AppealWhereInput = {};
    if (query.status) where.status = query.status;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appeal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { moderationAction: true },
      }),
      this.prisma.appeal.count({ where }),
    ]);

    return { items: rows.map((a) => this.toAppealItem(a)), total, page, pageSize };
  }

  /**
   * Decides a pending appeal. `Upheld` reverses the underlying action (`reversedAt`)
   * and, if it was a suspension/ban, reactivates the user via the Phase 8 reactivate
   * logic. `Denied` leaves the action standing. Deciding an already-decided appeal
   * is a 409. Appeals are append-only, so only the decision fields are mutated.
   *
   * All three writes (the action's `reversedAt`, the reactivate, and the appeal's own
   * decision fields) run inside one `prisma.$transaction` — otherwise a failure on the
   * last `appeal.update` would leave a user already reactivated and the action already
   * marked reversed, but the appeal permanently stuck at `Pending` with no way to
   * retry through the API (backend-eval D3-FAIL-2, Phase 10 cutover review).
   */
  async decideAppeal(
    id: string,
    dto: DecideAppealDto,
    ctx: ModerationActionContext,
  ): Promise<AppealListItemDto> {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id },
      include: { moderationAction: true },
    });
    if (!appeal) {
      throw new NotFoundException('Appeal not found');
    }
    if (appeal.status !== 'Pending') {
      throw new ConflictException(`Appeal is already ${appeal.status} and cannot be changed`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.decision === 'Upheld') {
        const action = appeal.moderationAction;
        if (!action.reversedAt) {
          await tx.moderationAction.update({
            where: { id: action.id },
            data: { reversedAt: new Date() },
          });
        }
        const wasUserSuspension =
          action.actionType === ModerationActionType.SuspendUser ||
          action.actionType === ModerationActionType.BanUser;
        if (wasUserSuspension && action.targetUserId) {
          const user = await tx.user.findUnique({ where: { id: action.targetUserId } });
          if (user?.suspendedAt) {
            // Reuse Phase 8 reactivate exactly — do NOT re-implement un-suspend here.
            await this.adminUsers.reactivate(action.targetUserId, ctx, tx);
          }
        }
      }

      await tx.appeal.update({
        where: { id },
        data: {
          status: dto.decision,
          reviewedByAdminId: ctx.actorAdminUserId,
          reviewedAt: new Date(),
          decisionNote: dto.decisionNote ?? null,
        },
      });

      return tx.appeal.findUniqueOrThrow({
        where: { id },
        include: { moderationAction: true },
      });
    });

    await this.recordAudit('moderation.manage_appeals', 'Appeal', id, ctx, {
      previous: { status: appeal.status },
      next: { status: dto.decision, moderationActionId: appeal.moderationActionId },
      reason: dto.decisionNote ?? null,
    });
    this.logger.log(`Appeal ${id} ${dto.decision} by admin ${ctx.actorAdminUserId}`);

    return this.toAppealItem(updated);
  }

  // --- Proof review (RBAC replacement for the legacy AdminGuard route) ------

  /**
   * Applies a manual admin verification decision to a completion — the RBAC-gated
   * replacement for the legacy `x-admin-key` `AdminService.updateVerification`. The
   * concurrency-critical logic is reproduced exactly: a `SELECT ... FOR UPDATE`
   * row-lock (so a decision and the auto-approve timer are mutually exclusive), a
   * 409 when the row is no longer Pending, and an atomic
   * `GREATEST(0, totalXp - xpAwarded)` XP reversal on rejection (clamped at 0, done
   * in the same statement to avoid a lost concurrent grant). It additionally sets the
   * real `verifiedByAdminId` FK while keeping the free-text `verifiedBy = 'admin'`
   * for backward-compat with rows/tooling that read it.
   */
  async reviewProof(
    completionId: string,
    dto: ReviewProofDto,
    ctx: ModerationActionContext,
  ): Promise<ProofReviewResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<LockedCompletionRow[]>`
        SELECT id, "userId", "xpAwarded", "verificationStatus"
        FROM completions
        WHERE id = ${completionId}
        FOR UPDATE`;

      if (!row) {
        throw new NotFoundException('Completion not found');
      }
      if (row.verificationStatus !== VerificationStatus.Pending) {
        throw new ConflictException(
          `Completion is already ${row.verificationStatus} and cannot be changed`,
        );
      }

      const verifiedAt = new Date();
      const isRejection = dto.status === VerificationStatus.Rejected;

      const updated = await tx.completion.update({
        where: { id: completionId },
        data: {
          verificationStatus: dto.status,
          verifiedAt,
          // Keep populating the free-text column (backward-compat) AND set the real FK.
          verifiedBy: PROOF_VERIFIER,
          verifiedByAdminId: ctx.actorAdminUserId,
          rejectionReason: isRejection ? (dto.rejectionReason ?? null) : null,
        },
        select: {
          id: true,
          verificationStatus: true,
          verifiedAt: true,
          verifiedBy: true,
          verifiedByAdminId: true,
          rejectionReason: true,
        },
      });

      if (isRejection) {
        await tx.$executeRaw`
          UPDATE users
          SET "totalXp" = GREATEST(0, "totalXp" - ${row.xpAwarded})
          WHERE id = ${row.userId}`;
      }

      return { updated, isRejection, xpAwarded: row.xpAwarded, userId: row.userId };
    });

    await this.recordAudit('proofs.review', 'Completion', completionId, ctx, {
      previous: { verificationStatus: VerificationStatus.Pending },
      next: { verificationStatus: result.updated.verificationStatus },
      reason: result.isRejection ? (dto.rejectionReason ?? null) : null,
    });
    this.logger.log(
      result.isRejection
        ? `Completion ${completionId} rejected by admin ${ctx.actorAdminUserId}; reversed ${result.xpAwarded} XP for user ${result.userId}`
        : `Completion ${completionId} approved by admin ${ctx.actorAdminUserId}`,
    );

    return {
      completionId: result.updated.id,
      verificationStatus: result.updated.verificationStatus,
      verifiedAt: result.updated.verifiedAt,
      verifiedBy: result.updated.verifiedBy,
      verifiedByAdminId: result.updated.verifiedByAdminId,
      rejectionReason: result.updated.rejectionReason,
    };
  }

  // --- internals -----------------------------------------------------------

  /** Resolves the user a report is ultimately about (the content's author, if content). */
  private async resolveReportTargetUser(report: {
    targetType: ModerationTargetType;
    targetId: string;
  }): Promise<string | null> {
    switch (report.targetType) {
      case ModerationTargetType.User:
        return report.targetId;
      case ModerationTargetType.Completion: {
        const c = await this.prisma.completion.findUnique({
          where: { id: report.targetId },
          select: { userId: true },
        });
        return c?.userId ?? null;
      }
      case ModerationTargetType.UserTaskSubmission: {
        const s = await this.prisma.userTaskSubmission.findUnique({
          where: { id: report.targetId },
          select: { submittedById: true },
        });
        return s?.submittedById ?? null;
      }
      case ModerationTargetType.Mission:
        // Missions are first-party curated content with no owning user.
        return null;
      default:
        return null;
    }
  }

  /**
   * Applies a user-directed action's side effect by reusing Phase 8 suspend/reactivate.
   * Takes the same `tx` the caller's `moderationAction.create` runs in, so a suspension
   * and the `ModerationAction` row recording why it happened commit or roll back
   * together (see `createAction`'s doc comment).
   */
  private async applyUserAction(
    actionType: ModerationActionType,
    targetUserId: string,
    reason: string,
    ctx: ModerationActionContext,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const user = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      throw new NotFoundException('Target user not found');
    }
    if (user.deletedAt) {
      throw new ConflictException('Cannot take a moderation action against a deleted account');
    }

    const isSuspending =
      actionType === ModerationActionType.SuspendUser ||
      actionType === ModerationActionType.BanUser;

    if (isSuspending && !user.suspendedAt) {
      // Exact Phase 8 mechanism: sets suspendedAt/reason/by + nulls refreshTokenHash.
      await this.adminUsers.suspend(targetUserId, { reason }, ctx, tx);
    } else if (actionType === ModerationActionType.ReinstateUser && user.suspendedAt) {
      await this.adminUsers.reactivate(targetUserId, ctx, tx);
    }
    // WarnUser (and a repeat suspend on an already-suspended user) record the action
    // without a user-state change.
  }

  private toReportListItem(report: {
    id: string;
    reporterUserId: string | null;
    targetType: ModerationTargetType;
    targetId: string;
    reason: string;
    details: string | null;
    status: ReportStatus;
    reviewedByAdminId: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ReportListItemDto {
    return {
      id: report.id,
      reporterUserId: report.reporterUserId,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      details: report.details,
      status: report.status,
      reviewedByAdminId: report.reviewedByAdminId,
      reviewedAt: report.reviewedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }

  private toActionSummary(action: {
    id: string;
    reportId: string | null;
    adminUserId: string;
    actionType: ModerationActionType;
    targetType: ModerationTargetType;
    targetId: string;
    targetUserId: string | null;
    reason: string;
    expiresAt: Date | null;
    reversedAt: Date | null;
    createdAt: Date;
  }): ModerationActionSummaryDto {
    return {
      id: action.id,
      reportId: action.reportId,
      adminUserId: action.adminUserId,
      actionType: action.actionType,
      targetType: action.targetType,
      targetId: action.targetId,
      targetUserId: action.targetUserId,
      reason: action.reason,
      expiresAt: action.expiresAt,
      reversedAt: action.reversedAt,
      createdAt: action.createdAt,
    };
  }

  private toAppealItem(appeal: {
    id: string;
    moderationActionId: string;
    appellantUserId: string;
    reason: string;
    status: AppealListItemDto['status'];
    reviewedByAdminId: string | null;
    reviewedAt: Date | null;
    decisionNote: string | null;
    createdAt: Date;
    moderationAction: Parameters<ModerationService['toActionSummary']>[0];
  }): AppealListItemDto {
    return {
      id: appeal.id,
      moderationActionId: appeal.moderationActionId,
      appellantUserId: appeal.appellantUserId,
      reason: appeal.reason,
      status: appeal.status,
      reviewedByAdminId: appeal.reviewedByAdminId,
      reviewedAt: appeal.reviewedAt,
      decisionNote: appeal.decisionNote,
      createdAt: appeal.createdAt,
      moderationAction: this.toActionSummary(appeal.moderationAction),
    };
  }

  /** Best-effort audit write (same convention as the other admin modules). */
  private async recordAudit(
    action: string,
    targetType: string,
    targetId: string,
    ctx: ModerationActionContext,
    payload: {
      previous: Record<string, unknown> | null;
      next: Record<string, unknown> | null;
      reason: string | null;
    },
  ): Promise<void> {
    await this.audit.record({
      actorAdminUserId: ctx.actorAdminUserId,
      action,
      targetType,
      targetId,
      previousValue: (payload.previous ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (payload.next ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      result: AuditResult.Success,
      reason: payload.reason,
    });
  }
}
