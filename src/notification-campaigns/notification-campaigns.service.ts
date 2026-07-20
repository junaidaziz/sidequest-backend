import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CampaignRecipientStatus,
  NotificationCampaign,
  NotificationCampaignStatus,
  Prisma,
} from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsQueryDto } from './dto/list-campaigns-query.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import {
  CampaignDetailDto,
  CampaignListItemDto,
  CampaignPageDto,
  CampaignStatsDto,
  PreviewAudienceDto,
} from './dto/campaign-response.dto';
import { NotificationCampaignsQueueService } from './notification-campaigns-queue.service';
import {
  CampaignActionContext,
  CampaignTargetFilter,
  buildTargetWhere,
} from './types/campaign-targeting';

/** Permission key that gates create/edit/delete — there is no `campaigns.delete`. */
const MANAGE_PERMISSION = 'campaigns.create';
/** Permission key that gates send/cancel. */
const SEND_PERMISSION = 'campaigns.send';

/** Minimal row shape returned by the `SELECT ... FOR UPDATE` lifecycle lock. */
interface LockedCampaignRow {
  id: string;
  status: NotificationCampaignStatus;
  scheduledAt: Date | null;
  deletedAt: Date | null;
}

/**
 * Admin notification-campaign management (Phase 11): CRUD for admin-authored
 * broadcasts, audience previewing, and the send/schedule/cancel lifecycle. The
 * actual fan-out to recipients runs off the request path in
 * NotificationCampaignsProcessor via the dedicated `campaigns` queue — this
 * service only owns the request-time state machine and reads.
 *
 * Immutability convention (matching missions/moderation): a campaign is only
 * editable/deletable while `Draft`; once it has started sending it is a 409 to
 * touch. Send/cancel state transitions two concurrent requests could race are
 * guarded by `SELECT ... FOR UPDATE` (PascalCase `"NotificationCampaign"` table —
 * this model has no `@@map`).
 */
@Injectable()
export class NotificationCampaignsService {
  private readonly logger = new Logger(NotificationCampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly queue: NotificationCampaignsQueueService,
  ) {}

  // --- Reads ---------------------------------------------------------------

  /** Paginated, status-filtered list. Soft-deleted campaigns are always excluded. */
  async list(query: ListCampaignsQueryDto): Promise<CampaignPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where: Prisma.NotificationCampaignWhereInput = { deletedAt: null };
    if (query.status) {
      where.status = query.status;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notificationCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationCampaign.count({ where }),
    ]);

    return { items: rows.map((r) => this.toListItem(r)), total, page, pageSize };
  }

  /** Full campaign view including the real delivery + open stats. */
  async getCampaign(id: string): Promise<CampaignDetailDto> {
    const campaign = await this.findActive(id);
    const stats = await this.getStats(id);
    return this.toDetail(campaign, stats);
  }

  /**
   * Resolves the campaign's saved `targetFilter` to a live-user count WITHOUT
   * creating any recipient rows — the admin UI's "this will reach N users"
   * preview before committing to a send. Read-only, no side effects, no audit.
   */
  async previewAudience(id: string): Promise<PreviewAudienceDto> {
    const campaign = await this.findActive(id);
    const where = buildTargetWhere(campaign.targetFilter as CampaignTargetFilter | null);
    const count = await this.prisma.user.count({ where });
    return { count };
  }

  // --- Mutations -----------------------------------------------------------

  /** Creates the campaign as a `Draft`. Nothing is sent until an explicit send. */
  async create(dto: CreateCampaignDto, ctx: CampaignActionContext): Promise<CampaignDetailDto> {
    const campaign = await this.prisma.notificationCampaign.create({
      data: {
        title: dto.title,
        headline: dto.headline,
        body: dto.body,
        data: this.toJsonInput(dto.data),
        targetFilter: this.toJsonInput(dto.targetFilter as Record<string, unknown> | undefined),
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: NotificationCampaignStatus.Draft,
        createdByAdminId: ctx.actorAdminUserId,
        updatedByAdminId: ctx.actorAdminUserId,
      },
    });

    await this.recordAudit(MANAGE_PERMISSION, campaign.id, ctx, {
      previous: null,
      next: { status: campaign.status, title: campaign.title },
      reason: null,
    });
    this.logger.log(`Campaign ${campaign.id} created by admin ${ctx.actorAdminUserId}`);
    return this.toDetail(campaign, this.emptyStats());
  }

  /**
   * Edits a campaign — allowed ONLY while `Draft` (a 409 otherwise). Row-locked
   * (same pattern as `remove()`) so a concurrent `send()` can't flip the campaign
   * to `Sending` between the status check and this write — without the lock, a
   * `send()` that wins the race would already have handed `headline`/`body` to
   * the fan-out processor by the time this update lands, silently sending a
   * mix of old and new content to different recipients (backend-eval D3-FAIL,
   * Phase 11 review — the exact hazard `remove()` was already guarded against).
   */
  async update(
    id: string,
    dto: UpdateCampaignDto,
    ctx: CampaignActionContext,
  ): Promise<CampaignDetailDto> {
    const previousTitle = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCampaign(tx, id);
      if (row.status !== NotificationCampaignStatus.Draft) {
        throw new ConflictException(
          `Campaign is ${row.status} and can no longer be edited (only a Draft is editable)`,
        );
      }

      const data: Prisma.NotificationCampaignUncheckedUpdateInput = {
        updatedByAdminId: ctx.actorAdminUserId,
      };
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.headline !== undefined) data.headline = dto.headline;
      if (dto.body !== undefined) data.body = dto.body;
      if (dto.data !== undefined) data.data = this.toJsonInput(dto.data);
      if (dto.targetFilter !== undefined) {
        data.targetFilter = this.toJsonInput(dto.targetFilter as Record<string, unknown>);
      }
      if (dto.scheduledAt !== undefined) {
        data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
      }

      const current = await tx.notificationCampaign.findUniqueOrThrow({ where: { id } });
      await tx.notificationCampaign.update({ where: { id }, data });
      return current.title;
    });

    const updated = await this.findActive(id);
    await this.recordAudit(MANAGE_PERMISSION, id, ctx, {
      previous: { title: previousTitle },
      next: { title: updated.title },
      reason: null,
    });
    this.logger.log(`Campaign ${id} updated by admin ${ctx.actorAdminUserId}`);
    return this.toDetail(updated, await this.getStats(id));
  }

  /**
   * Soft-deletes a campaign — allowed ONLY while `Draft` (a 409 otherwise). A
   * campaign that has started sending is immutable. Row-locked so a concurrent
   * send can't flip it out of Draft mid-delete.
   */
  async remove(id: string, ctx: CampaignActionContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCampaign(tx, id);
      if (row.status !== NotificationCampaignStatus.Draft) {
        throw new ConflictException(
          `Campaign is ${row.status} and can no longer be deleted (only a Draft is deletable)`,
        );
      }
      await tx.notificationCampaign.update({
        where: { id },
        data: { deletedAt: new Date(), updatedByAdminId: ctx.actorAdminUserId },
      });
    });

    await this.recordAudit(MANAGE_PERMISSION, id, ctx, {
      previous: { deleted: false },
      next: { deleted: true },
      reason: null,
    });
    this.logger.log(`Campaign ${id} soft-deleted by admin ${ctx.actorAdminUserId}`);
  }

  // --- Lifecycle -----------------------------------------------------------

  /**
   * Sends (or schedules) a campaign. Valid only from `Draft` or `Scheduled` (a
   * 409 from any other state — e.g. already Sending/Sent/Cancelled). Row-locked so
   * two concurrent sends serialize rather than double-enqueue. If `scheduledAt` is
   * in the future the campaign goes `Scheduled` with a delayed job; otherwise it
   * goes `Sending` with an immediate job. If the enqueue fails, the status change
   * is compensated back so the admin can retry rather than leaving a job-less
   * campaign wedged.
   */
  async send(id: string, ctx: CampaignActionContext): Promise<CampaignDetailDto> {
    const now = Date.now();
    const decision = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCampaign(tx, id);
      if (
        row.status !== NotificationCampaignStatus.Draft &&
        row.status !== NotificationCampaignStatus.Scheduled
      ) {
        throw new ConflictException(
          `Campaign is ${row.status} and cannot be sent (only Draft or Scheduled can be sent)`,
        );
      }

      const scheduledMs = row.scheduledAt ? row.scheduledAt.getTime() : 0;
      const isFuture = scheduledMs > now;
      const nextStatus = isFuture
        ? NotificationCampaignStatus.Scheduled
        : NotificationCampaignStatus.Sending;

      await tx.notificationCampaign.update({
        where: { id },
        data: { status: nextStatus, updatedByAdminId: ctx.actorAdminUserId },
      });

      return { previousStatus: row.status, nextStatus, delayMs: isFuture ? scheduledMs - now : 0 };
    });

    try {
      await this.queue.enqueueSend(id, decision.delayMs);
    } catch (error) {
      // Compensate: the fan-out never got queued, so don't leave the campaign
      // stuck in Sending/Scheduled with no job behind it.
      await this.prisma.notificationCampaign.update({
        where: { id },
        data: { status: decision.previousStatus },
      });
      this.logger.error(
        `Failed to enqueue fan-out for campaign ${id}; reverted to ${decision.previousStatus}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('Failed to enqueue campaign send; please retry');
    }

    await this.recordAudit(SEND_PERMISSION, id, ctx, {
      previous: { status: decision.previousStatus },
      next: { status: decision.nextStatus },
      reason: null,
    });
    this.logger.log(
      `Campaign ${id} ${decision.nextStatus} by admin ${ctx.actorAdminUserId} (delay ${decision.delayMs}ms)`,
    );
    return this.getCampaign(id);
  }

  /**
   * Cancels a campaign. Valid only from `Scheduled` or `Sending` (a 409 otherwise).
   *
   * What cancel CAN stop:
   *  - A `Scheduled` campaign whose delayed job has not fired yet: reliably
   *    prevented — the processor re-locks and no-ops the moment it sees Cancelled.
   *  - Recipients not yet processed in an in-flight `Sending` fan-out: the
   *    processor re-checks the campaign's status before each recipient and, once
   *    Cancelled, stops sending further and marks the remainder `Skipped`.
   *
   * What cancel CANNOT undo (best-effort, documented limitation):
   *  - Recipients already delivered before the cancel landed — their in-app
   *    Notification and any push are already out and are never clawed back.
   */
  async cancel(id: string, ctx: CampaignActionContext): Promise<CampaignDetailDto> {
    const previousStatus = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockCampaign(tx, id);
      if (
        row.status !== NotificationCampaignStatus.Scheduled &&
        row.status !== NotificationCampaignStatus.Sending
      ) {
        throw new ConflictException(
          `Campaign is ${row.status} and cannot be cancelled (only Scheduled or Sending can be cancelled)`,
        );
      }
      await tx.notificationCampaign.update({
        where: { id },
        data: {
          status: NotificationCampaignStatus.Cancelled,
          updatedByAdminId: ctx.actorAdminUserId,
        },
      });
      return row.status;
    });

    await this.recordAudit(SEND_PERMISSION, id, ctx, {
      previous: { status: previousStatus },
      next: { status: NotificationCampaignStatus.Cancelled },
      reason: null,
    });
    this.logger.log(`Campaign ${id} cancelled by admin ${ctx.actorAdminUserId}`);
    return this.getCampaign(id);
  }

  // --- internals -----------------------------------------------------------

  /**
   * Real delivery + open analytics from the recipient rows (the source of truth,
   * more precise than the denormalized counters). `openCount` joins each
   * recipient's `Notification.readAt` — a genuine, derivable open metric. Click
   * and conversion metrics are deliberately absent (no backing infrastructure —
   * see CampaignStatsDto).
   */
  private async getStats(campaignId: string): Promise<CampaignStatsDto> {
    const [grouped, openCount] = await Promise.all([
      this.prisma.notificationCampaignRecipient.groupBy({
        by: ['status'],
        where: { campaignId },
        _count: { _all: true },
      }),
      this.prisma.notificationCampaignRecipient.count({
        where: { campaignId, notification: { readAt: { not: null } } },
      }),
    ]);

    const countFor = (status: CampaignRecipientStatus): number =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;

    const sent = countFor(CampaignRecipientStatus.Sent);
    const total = grouped.reduce((acc, g) => acc + g._count._all, 0);

    return {
      totalRecipients: total,
      pending: countFor(CampaignRecipientStatus.Pending),
      sent,
      failed: countFor(CampaignRecipientStatus.Failed),
      skipped: countFor(CampaignRecipientStatus.Skipped),
      openCount,
      openRate: sent > 0 ? openCount / sent : 0,
    };
  }

  private emptyStats(): CampaignStatsDto {
    return {
      totalRecipients: 0,
      pending: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      openCount: 0,
      openRate: 0,
    };
  }

  /** Loads a non-deleted campaign or throws 404. */
  private async findActive(id: string): Promise<NotificationCampaign> {
    const campaign = await this.prisma.notificationCampaign.findFirst({
      where: { id, deletedAt: null },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  /** `SELECT ... FOR UPDATE` on the PascalCase table; throws 404 if missing/deleted. */
  private async lockCampaign(tx: Prisma.TransactionClient, id: string): Promise<LockedCampaignRow> {
    const [row] = await tx.$queryRaw<LockedCampaignRow[]>`
      SELECT id, status, "scheduledAt", "deletedAt"
      FROM "NotificationCampaign"
      WHERE id = ${id}
      FOR UPDATE`;
    if (!row || row.deletedAt) {
      throw new NotFoundException('Campaign not found');
    }
    return row;
  }

  private toJsonInput(
    value: Record<string, unknown> | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return value === null || value === undefined
      ? Prisma.JsonNull
      : (value as Prisma.InputJsonValue);
  }

  private toListItem(row: NotificationCampaign): CampaignListItemDto {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      scheduledAt: row.scheduledAt,
      totalRecipients: row.totalRecipients,
      sentCount: row.sentCount,
      failedCount: row.failedCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toDetail(row: NotificationCampaign, stats: CampaignStatsDto): CampaignDetailDto {
    return {
      ...this.toListItem(row),
      headline: row.headline,
      body: row.body,
      data: (row.data as Record<string, unknown> | null) ?? null,
      targetFilter: (row.targetFilter as Record<string, unknown> | null) ?? null,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdByAdminId: row.createdByAdminId,
      updatedByAdminId: row.updatedByAdminId,
      stats,
    };
  }

  /** Best-effort audit write (same convention as the other admin modules). */
  private async recordAudit(
    action: string,
    targetId: string,
    ctx: CampaignActionContext,
    payload: {
      previous: Record<string, unknown> | null;
      next: Record<string, unknown> | null;
      reason: string | null;
    },
  ): Promise<void> {
    await this.audit.record({
      actorAdminUserId: ctx.actorAdminUserId,
      action,
      targetType: 'NotificationCampaign',
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
