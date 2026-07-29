import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModerationTargetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';
import { CreateReportResponseDto } from './dto/report-response.dto';

/**
 * Number of *distinct* reporters that must report the same target before it is
 * hidden globally (for everyone), not just for each individual reporter. The
 * spec: a single report hides for the reporter only; a second independent user
 * reporting the same target escalates to a global hide.
 */
const GLOBAL_HIDE_REPORTER_THRESHOLD = 2;

/** Reason stamped on an auto-created global hide, distinguishing it from an admin hide. */
const AUTO_HIDE_REASON = `Auto-hidden: reported by ${GLOBAL_HIDE_REPORTER_THRESHOLD}+ distinct users`;

/**
 * User-facing reporting (P0 gap #6). A regular authenticated user reports a
 * target (another user's completion / task submission, or a user account); the
 * target is immediately hidden from that reporter's own view (`HiddenContent`),
 * and once a second *distinct* user reports the same target it is hidden
 * globally (`GlobalContentHide`).
 *
 * Distinct from the admin `ModerationService`: this is the consumer entry point
 * (JwtAuthGuard, no RBAC). Global hides created here are system-generated and so
 * use the lightweight `GlobalContentHide` flag rather than a `ModerationAction`
 * (which requires an acting `AdminUser`). Admin-driven global hides still flow
 * through `ModerationService.createAction` unchanged.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Files a report and applies its visibility effect. Idempotent per
   * (reporter, target): a user re-reporting the same target reuses their
   * existing report and hide rather than stacking duplicates, and never counts
   * twice toward the global-hide threshold. Runs the report write, the
   * reporter-local hide, and the distinct-reporter escalation in one
   * transaction. The per-(reporter, target) `upsert` leans on the
   * `@@unique([reporterUserId, targetType, targetId])` DB constraint so two
   * concurrent identical reports converge on a single row (deterministic
   * `reportId`, no accumulation) instead of the old racy findFirst-then-create;
   * the global-hide `upsert` is keyed uniquely on the target so concurrent
   * escalations are idempotent too (the established unique-constraint pattern)
   * rather than needing a row lock.
   */
  async createReport(userId: string, dto: CreateReportDto): Promise<CreateReportResponseDto> {
    if (dto.targetType === ModerationTargetType.User && dto.targetId === userId) {
      throw new BadRequestException('You cannot report your own account');
    }

    await this.assertTargetExists(dto.targetType, dto.targetId);

    const { report, globallyHidden } = await this.prisma.$transaction(async (tx) => {
      // One report per (reporter, target): the composite unique makes this upsert
      // reuse an existing row so a repeat report is a no-op that still confirms
      // the hide and can't inflate the distinct-reporter count — and closes the
      // race two concurrent first reports would otherwise slip through.
      const reportRow = await tx.report.upsert({
        where: {
          reporterUserId_targetType_targetId: {
            reporterUserId: userId,
            targetType: dto.targetType,
            targetId: dto.targetId,
          },
        },
        create: {
          reporterUserId: userId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reason: dto.reason,
          details: dto.details ?? null,
        },
        update: {},
      });

      // Reporter-local hide — idempotent on (user, target).
      await tx.hiddenContent.upsert({
        where: {
          userId_targetType_targetId: {
            userId,
            targetType: dto.targetType,
            targetId: dto.targetId,
          },
        },
        create: {
          userId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reportId: reportRow.id,
        },
        update: {},
      });

      // Escalation: count DISTINCT reporters (nulls excluded) for this target.
      const distinctReporters = await tx.report.findMany({
        where: {
          targetType: dto.targetType,
          targetId: dto.targetId,
          deletedAt: null,
          reporterUserId: { not: null },
        },
        distinct: ['reporterUserId'],
        select: { reporterUserId: true },
      });

      let globallyHidden = false;
      if (distinctReporters.length >= GLOBAL_HIDE_REPORTER_THRESHOLD) {
        await tx.globalContentHide.upsert({
          where: {
            targetType_targetId: { targetType: dto.targetType, targetId: dto.targetId },
          },
          create: {
            targetType: dto.targetType,
            targetId: dto.targetId,
            reason: AUTO_HIDE_REASON,
          },
          update: {},
        });
        globallyHidden = true;
      }

      return { report: reportRow, globallyHidden };
    });

    this.logger.log(
      `Report ${report.id} filed by user ${userId} on ${dto.targetType} ${dto.targetId} ` +
        `(globallyHidden=${globallyHidden})`,
    );

    return {
      reportId: report.id,
      status: report.status,
      targetType: report.targetType,
      targetId: report.targetId,
      hiddenForReporter: true,
      globallyHidden,
      createdAt: report.createdAt,
    };
  }

  /**
   * Target ids of `targetType` a user has hidden (reporter-local). Reusable by
   * read paths that surface other users' content, to filter out the caller's
   * own hides. Global hides live in `GlobalContentHide` and apply to everyone.
   */
  async listHiddenTargetIds(userId: string, targetType: ModerationTargetType): Promise<string[]> {
    const rows = await this.prisma.hiddenContent.findMany({
      where: { userId, targetType },
      select: { targetId: true },
    });
    return rows.map((r) => r.targetId);
  }

  /**
   * Of the given `targetIds` (all of one `targetType`), the subset that must be
   * hidden from `userId`'s view — either globally (`GlobalContentHide`, applies
   * to everyone) or reporter-locally (`HiddenContent`, only this viewer). Returns
   * a Set for O(1) membership checks. The single batched query per table keeps a
   * list read path (e.g. `GET /tasks/:id/submissions`) at two queries regardless
   * of how many candidates it holds — no per-item `isHiddenForUser` fan-out — and
   * keeps all hide-query logic in this service rather than duplicated by callers.
   * An empty input short-circuits with no DB round trip.
   */
  async filterHiddenTargetIds(
    userId: string,
    targetType: ModerationTargetType,
    targetIds: string[],
  ): Promise<Set<string>> {
    if (targetIds.length === 0) {
      return new Set();
    }
    const [globalHides, localHides] = await Promise.all([
      this.prisma.globalContentHide.findMany({
        where: { targetType, targetId: { in: targetIds } },
        select: { targetId: true },
      }),
      this.prisma.hiddenContent.findMany({
        where: { userId, targetType, targetId: { in: targetIds } },
        select: { targetId: true },
      }),
    ]);
    return new Set([...globalHides.map((r) => r.targetId), ...localHides.map((r) => r.targetId)]);
  }

  /** Whether a target is hidden either globally or for the given viewing user. */
  async isHiddenForUser(
    userId: string,
    targetType: ModerationTargetType,
    targetId: string,
  ): Promise<boolean> {
    const [globalHide, localHide] = await Promise.all([
      this.prisma.globalContentHide.findUnique({
        where: { targetType_targetId: { targetType, targetId } },
        select: { id: true },
      }),
      this.prisma.hiddenContent.findUnique({
        where: { userId_targetType_targetId: { userId, targetType, targetId } },
        select: { id: true },
      }),
    ]);
    return globalHide !== null || localHide !== null;
  }

  /** 404s unless the reported target exists (and, for a user, is not soft-deleted). */
  private async assertTargetExists(
    targetType: ModerationTargetType,
    targetId: string,
  ): Promise<void> {
    let exists: { id: string } | null;
    switch (targetType) {
      case ModerationTargetType.Completion:
        exists = await this.prisma.completion.findUnique({
          where: { id: targetId },
          select: { id: true },
        });
        break;
      case ModerationTargetType.UserTaskSubmission:
        exists = await this.prisma.userTaskSubmission.findUnique({
          where: { id: targetId },
          select: { id: true },
        });
        break;
      case ModerationTargetType.User:
        exists = await this.prisma.user.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { id: true },
        });
        break;
      default:
        // USER_REPORTABLE_TARGET_TYPES excludes every other case; kept exhaustive
        // so a future enum addition surfaces here instead of silently passing.
        exists = null;
    }

    if (!exists) {
      throw new NotFoundException('Report target not found');
    }
  }
}
