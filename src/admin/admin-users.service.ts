import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, User, VerificationStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { computeLevel } from '../home/level.util';
import { RestrictableFeature, UserAccountStatus } from './admin-users.constants';
import {
  AdminUserDetailDto,
  AdminUserExportDto,
  AdminUserListItemDto,
  AdminUserPageDto,
  AdminUserProofDto,
  ResetVerificationResponseDto,
} from './dto/admin-user-response.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ResetVerificationDto } from './dto/reset-verification.dto';
import { RestrictUserDto } from './dto/restrict-user.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

/** Polymorphic audit target type for every action in this module. */
const AUDIT_TARGET = 'User';
/** Cap on how many proof/challenge rows the detail/export view returns. */
const HISTORY_LIMIT = 100;

/** Per-request audit context threaded from the controller (IP + user agent). */
export interface AdminUserActionContext {
  actorAdminUserId: string;
  ipAddress: string;
  userAgent: string | null;
}

interface LockedCompletionRow {
  id: string;
  userId: string;
  xpAwarded: number;
  verificationStatus: VerificationStatus;
}

/**
 * Admin-facing management of mobile-app end users (the `User` table) — search,
 * profile view, suspend/reactivate, feature restriction, verification reset,
 * deletion requests, and data export (Phase 8, web platform).
 *
 * This is entirely distinct from admin-account management (`AdminUser`, handled
 * by the rbac module) and from the legacy shared-key `AdminGuard` completion
 * route (untouched here). Every mutating method records an audit-log entry.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly storage: StorageService,
    private readonly authService: AuthService,
  ) {}

  /** Paginated, filtered list. Only filters on columns that exist on `User`. */
  async list(query: ListUsersQueryDto): Promise<AdminUserPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = this.buildListWhere(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toListItem(row)),
      total,
      page,
      pageSize,
    };
  }

  /** Full profile view, including proof/challenge/moderation history. */
  async getDetail(userId: string): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.buildDetail(user);
  }

  /**
   * Suspends an account. Sets `suspendedAt`/`suspensionReason`/`suspendedByAdminId`
   * and revokes the refresh token so the user cannot rotate into a fresh access
   * token — combined with the JwtStrategy `suspendedAt` check, their existing
   * access token stops working on its very next request.
   */
  async suspend(
    userId: string,
    dto: SuspendUserDto,
    ctx: AdminUserActionContext,
  ): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.deletedAt) {
      throw new ConflictException('Cannot suspend a deleted account');
    }
    if (user.suspendedAt) {
      throw new ConflictException('Account is already suspended');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        suspendedAt: new Date(),
        suspensionReason: dto.reason,
        suspendedByAdminId: ctx.actorAdminUserId,
        // Revoke the refresh token so it can't be exchanged for a new access
        // token — makes the suspension immediate on both auth paths.
        refreshTokenHash: null,
      },
    });
    await this.recordAudit('users.suspend', userId, ctx, {
      previous: { status: this.deriveStatus(user) },
      next: { status: UserAccountStatus.Suspended },
      reason: dto.reason,
    });
    this.logger.log(`User ${userId} suspended by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(updated);
  }

  /** Lifts a suspension. The user re-authenticates (refresh token was revoked). */
  async reactivate(userId: string, ctx: AdminUserActionContext): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.suspendedAt) {
      throw new ConflictException('Account is not suspended');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: null, suspensionReason: null, suspendedByAdminId: null },
    });
    await this.recordAudit('users.suspend', userId, ctx, {
      previous: { status: UserAccountStatus.Suspended },
      next: { status: UserAccountStatus.Active },
      reason: 'reactivated',
    });
    this.logger.log(`User ${userId} reactivated by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(updated);
  }

  /** Replaces the user's feature-restriction set with exactly `dto.features`. */
  async restrict(
    userId: string,
    dto: RestrictUserDto,
    ctx: AdminUserActionContext,
  ): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.deletedAt) {
      throw new ConflictException('Cannot restrict a deleted account');
    }

    const next = Array.from(new Set(dto.features));
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { restrictedFeatures: next },
    });
    await this.recordAudit('users.edit', userId, ctx, {
      previous: { restrictedFeatures: user.restrictedFeatures },
      next: { restrictedFeatures: next },
      reason: dto.reason,
    });
    this.logger.log(`Restrictions updated for user ${userId} by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(updated);
  }

  /**
   * Resets one of the user's completions back to `Pending`. Mirrors the row-lock
   * concurrency pattern of the legacy AdminService so a reset and the auto-approve
   * timer can never both apply. If the completion was `Rejected` (its optimistic
   * XP already reversed), the XP is restored so the row again matches the "Pending
   * ⇒ XP awarded" invariant; a previously `Approved` row keeps its XP unchanged.
   */
  async resetVerification(
    userId: string,
    dto: ResetVerificationDto,
    ctx: AdminUserActionContext,
  ): Promise<ResetVerificationResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<LockedCompletionRow[]>`
        SELECT id, "userId", "xpAwarded", "verificationStatus"
        FROM completions
        WHERE id = ${dto.completionId}
        FOR UPDATE`;

      if (!row || row.userId !== userId) {
        throw new NotFoundException('Completion not found for this user');
      }
      if (row.verificationStatus === VerificationStatus.Pending) {
        throw new ConflictException('Completion is already Pending');
      }

      const wasRejected = row.verificationStatus === VerificationStatus.Rejected;
      const updated = await tx.completion.update({
        where: { id: row.id },
        data: {
          verificationStatus: VerificationStatus.Pending,
          verifiedAt: null,
          verifiedBy: null,
          verifiedByAdminId: null,
          rejectionReason: null,
        },
        select: { id: true, verificationStatus: true },
      });

      if (wasRejected && row.xpAwarded > 0) {
        // Restore the optimistic XP that was reversed at rejection. Atomic SQL
        // increment (not read-modify-write) so a concurrent grant can't be lost.
        await tx.$executeRaw`
          UPDATE users
          SET "totalXp" = "totalXp" + ${row.xpAwarded}
          WHERE id = ${userId}`;
      }

      return { updated, previousStatus: row.verificationStatus, wasRejected };
    });

    await this.recordAudit('users.edit', userId, ctx, {
      previous: { completionId: dto.completionId, verificationStatus: result.previousStatus },
      next: { completionId: dto.completionId, verificationStatus: VerificationStatus.Pending },
      reason: dto.reason ?? 'verification reset',
    });
    this.logger.log(
      `Completion ${dto.completionId} reset to Pending for user ${userId} by admin ${ctx.actorAdminUserId}`,
    );
    return {
      completionId: result.updated.id,
      verificationStatus: result.updated.verificationStatus,
    };
  }

  /**
   * Admin-initiated deletion request. Reuses the *exact* self-service
   * anonymization (soft-delete + de-reference media + best-effort cleanup) via
   * `AuthService.anonymizeUserAccount`, rather than duplicating that logic here.
   */
  async deleteUser(userId: string, reason: string, ctx: AdminUserActionContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    await this.authService.anonymizeUserAccount(userId, user.avatarUrl);
    await this.recordAudit('users.delete', userId, ctx, {
      previous: { status: this.deriveStatus(user) },
      next: { status: UserAccountStatus.Deleted },
      reason,
    });
    this.logger.log(`User ${userId} deleted by admin ${ctx.actorAdminUserId}`);
  }

  /** Builds a full data export for the user and records the access in the audit log. */
  async exportUser(userId: string, ctx: AdminUserActionContext): Promise<AdminUserExportDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [detail, codesMade, conversions, rewardsEarned] = await Promise.all([
      this.buildDetail(user),
      this.prisma.referralCode.count({ where: { userId } }),
      this.prisma.referral.count({ where: { referrerId: userId, refereeId: { not: null } } }),
      this.prisma.referralReward.count({ where: { userId } }),
    ]);

    await this.recordAudit('users.export', userId, ctx, {
      previous: null,
      next: { exported: true },
      reason: 'data export',
    });
    this.logger.log(`Data export generated for user ${userId} by admin ${ctx.actorAdminUserId}`);

    return {
      profile: detail,
      exportedAt: new Date(),
      referrals: { codesMade, conversions, rewardsEarned },
    };
  }

  // --- internals ---------------------------------------------------------

  private buildListWhere(query: ListUsersQueryDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.status === UserAccountStatus.Active) {
      where.deletedAt = null;
      where.suspendedAt = null;
    } else if (query.status === UserAccountStatus.Suspended) {
      where.deletedAt = null;
      where.suspendedAt = { not: null };
    } else if (query.status === UserAccountStatus.Deleted) {
      where.deletedAt = { not: null };
    }

    if (query.registeredFrom || query.registeredTo) {
      where.createdAt = {};
      if (query.registeredFrom) where.createdAt.gte = new Date(query.registeredFrom);
      if (query.registeredTo) where.createdAt.lte = new Date(query.registeredTo);
    }

    if (query.lastCompletionFrom || query.lastCompletionTo) {
      const range: Prisma.DateTimeNullableFilter = {};
      if (query.lastCompletionFrom) range.gte = new Date(query.lastCompletionFrom);
      if (query.lastCompletionTo) range.lte = new Date(query.lastCompletionTo);
      where.lastCompletionDate = range;
    }

    if (query.hasChallengeParticipation === true) {
      where.OR = [
        ...(where.OR ? (where.OR as Prisma.UserWhereInput[]) : []),
        { createdTasks: { some: {} } },
        { assignedTasks: { some: {} } },
      ];
    } else if (query.hasChallengeParticipation === false) {
      where.createdTasks = { none: {} };
      where.assignedTasks = { none: {} };
    }

    if (query.isGuest !== undefined) {
      where.isGuest = query.isGuest;
    }

    return where;
  }

  private deriveStatus(user: Pick<User, 'deletedAt' | 'suspendedAt'>): UserAccountStatus {
    if (user.deletedAt) return UserAccountStatus.Deleted;
    if (user.suspendedAt) return UserAccountStatus.Suspended;
    return UserAccountStatus.Active;
  }

  private toListItem(user: User): AdminUserListItemDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isGuest: user.isGuest,
      status: this.deriveStatus(user),
      totalXp: user.totalXp,
      level: computeLevel(user.totalXp).level,
      currentStreak: user.currentStreak,
      lastCompletionDate: user.lastCompletionDate,
      createdAt: user.createdAt,
      suspendedAt: user.suspendedAt,
    };
  }

  private async buildDetail(user: User): Promise<AdminUserDetailDto> {
    const [completions, createdTasks, assignedTasks, reportsAgainst, actionsAgainst] =
      await Promise.all([
        this.prisma.completion.findMany({
          where: { userId: user.id },
          orderBy: { completedAt: 'desc' },
          take: HISTORY_LIMIT,
          include: { mission: { select: { title: true } } },
        }),
        this.prisma.userTask.findMany({
          where: { creatorId: user.id },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
        }),
        this.prisma.userTask.findMany({
          where: { assigneeId: user.id },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
        }),
        this.prisma.report.findMany({
          where: { targetType: 'User', targetId: user.id, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
        }),
        this.prisma.moderationAction.findMany({
          where: { targetUserId: user.id },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
        }),
      ]);

    const proofHistory = await Promise.all(
      completions.map(async (c): Promise<AdminUserProofDto> => {
        return {
          completionId: c.id,
          missionId: c.missionId,
          missionTitle: c.mission.title,
          proofType: c.proofType,
          proofUrl: c.proofKey ? await this.storage.getSignedDownloadUrl(c.proofKey) : null,
          proofText: c.proofText,
          xpAwarded: c.xpAwarded,
          verificationStatus: c.verificationStatus,
          completedAt: c.completedAt,
          verifiedAt: c.verifiedAt,
          rejectionReason: c.rejectionReason,
        };
      }),
    );

    const challenges = [
      ...createdTasks.map((t) => ({
        id: t.id,
        title: t.title,
        role: 'creator' as const,
        status: t.status,
        rewardXp: t.rewardXp,
        createdAt: t.createdAt,
      })),
      ...assignedTasks.map((t) => ({
        id: t.id,
        title: t.title,
        role: 'assignee' as const,
        status: t.status,
        rewardXp: t.rewardXp,
        createdAt: t.createdAt,
      })),
    ];

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isGuest: user.isGuest,
      status: this.deriveStatus(user),
      avatarUrl: user.avatarUrl ? await this.storage.getSignedDownloadUrl(user.avatarUrl) : null,
      totalXp: user.totalXp,
      level: computeLevel(user.totalXp).level,
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastCompletionDate: user.lastCompletionDate,
      createdAt: user.createdAt,
      suspendedAt: user.suspendedAt,
      suspensionReason: user.suspensionReason,
      restrictedFeatures: user.restrictedFeatures as RestrictableFeature[],
      proofHistory,
      challenges,
      moderation: {
        reportsAgainst: reportsAgainst.map((r) => ({
          id: r.id,
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
        })),
        actionsAgainst: actionsAgainst.map((a) => ({
          id: a.id,
          actionType: a.actionType,
          reason: a.reason,
          reversedAt: a.reversedAt,
          createdAt: a.createdAt,
        })),
      },
    };
  }

  /** Best-effort audit write (same convention as the other admin modules). */
  private async recordAudit(
    action: string,
    userId: string,
    ctx: AdminUserActionContext,
    payload: {
      previous: Record<string, unknown> | null;
      next: Record<string, unknown> | null;
      reason: string | null;
    },
  ): Promise<void> {
    await this.audit.record({
      actorAdminUserId: ctx.actorAdminUserId,
      action,
      targetType: AUDIT_TARGET,
      targetId: userId,
      previousValue: (payload.previous ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (payload.next ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      result: AuditResult.Success,
      reason: payload.reason,
    });
  }
}
