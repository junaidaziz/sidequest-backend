import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Mission, MissionStatus, Prisma } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { MissionPoolService } from '../missions/mission-pool.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { ListMissionsQueryDto } from './dto/list-missions-query.dto';
import {
  AdminMissionDetailDto,
  AdminMissionListItemDto,
  AdminMissionPageDto,
} from './dto/mission-admin-response.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';

/** Polymorphic audit target type for every action in this module. */
const AUDIT_TARGET = 'Mission';
/** Upper bound on the auto-suffix search when de-duplicating a duplicated title. */
const MAX_DUPLICATE_ATTEMPTS = 100;

/** Per-request audit context threaded from the controller (actor + IP + UA). */
export interface AdminMissionActionContext {
  actorAdminUserId: string;
  ipAddress: string;
  userAgent: string | null;
}

/** Minimal row shape returned by the `SELECT ... FOR UPDATE` lifecycle lock. */
interface LockedMissionRow {
  id: string;
  status: MissionStatus;
  isActive: boolean;
  deletedAt: Date | null;
}

/**
 * Admin-facing authoring of the curated Mission pool (Phase 9) — full CRUD plus
 * the publish / unpublish / archive / feature / duplicate lifecycle. Gated by the
 * RBAC system (`AdminJwtAuthGuard` + `PermissionGuard`), NOT the legacy
 * shared-key `AdminGuard`. Until now missions were seed-file-only.
 *
 * ## `status` ↔ `isActive` relationship (the load-bearing decision)
 *
 * The public generator (`MissionPoolService.getActivePool`, feeding
 * `POST /missions/generate`) selects on `isActive: true, deletedAt: null` and
 * does **not** read `status`. So `isActive` is the true generator-visibility
 * switch. This module therefore treats `isActive` as a *derived* flag driven by
 * the lifecycle, never independently settable through the create/update DTOs:
 *
 *   - create               → `Draft`,     `isActive: false`  (invisible)
 *   - publish              → `Published`, `isActive: true`   (visible) + approval stamp
 *   - unpublish            → `Draft`,     `isActive: false`  (invisible) + approval cleared
 *   - archive              → `Archived`,  `isActive: false`  (invisible)
 *   - delete (soft)        → `deletedAt` set, `isActive: false` (invisible)
 *
 * This keeps the invariant `isActive === (status === Published)` for every
 * admin-authored mission and preserves the existing seed pool (backfilled to
 * `Published` + default `isActive: true`) exactly as the generator already sees
 * it. Every visibility change invalidates the short-TTL Redis pool cache so the
 * next `generate` call reflects it immediately rather than up to the TTL later.
 *
 * "Approve" and "publish" are the same action here: Missions have no separate
 * user-submission source (the peer-to-peer user-generated system is the distinct
 * `UserTask` model, out of scope), so there is no approval queue to model — the
 * `challenges.approve` permission simply also authorizes publish.
 *
 * Deletes/unpublishes never touch `Completion`/`SavedMission` rows: soft-delete
 * only sets `deletedAt`, so historical records keep pointing at a real Mission.
 */
@Injectable()
export class AdminChallengesService {
  private readonly logger = new Logger(AdminChallengesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly missionPool: MissionPoolService,
  ) {}

  /** Paginated, filtered list. Soft-deleted missions are always excluded. */
  async list(query: ListMissionsQueryDto): Promise<AdminMissionPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = this.buildListWhere(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.mission.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.mission.count({ where }),
    ]);

    const counts = await this.completionCounts(rows.map((row) => row.id));

    return {
      items: rows.map((row) => this.toListItem(row, counts[row.id] ?? 0)),
      total,
      page,
      pageSize,
    };
  }

  /** Full detail view for a single, non-deleted mission. */
  async getById(id: string): Promise<AdminMissionDetailDto> {
    const mission = await this.findActive(id);
    return this.buildDetail(mission);
  }

  /**
   * Creates a mission as `Draft` / `isActive: false`, authored by the caller. It
   * is invisible to the generator until an explicit publish. Title collisions
   * (the `Mission.title` unique constraint) surface as a 409.
   */
  async create(dto: CreateMissionDto, ctx: AdminMissionActionContext): Promise<AdminMissionDetailDto> {
    this.assertDateWindow(dto.startDate, dto.endDate);

    const mission = await this.runUniqueTitle(() =>
      this.prisma.mission.create({
        data: {
          title: dto.title,
          category: dto.category,
          description: dto.description,
          fullBrief: dto.fullBrief,
          proofRequirement: dto.proofRequirement,
          estimatedMinutes: dto.estimatedMinutes,
          xpReward: dto.xpReward,
          difficulty: dto.difficulty,
          difficultyDots: dto.difficultyDots,
          crewTags: dto.crewTags,
          settingTags: dto.settingTags,
          costTier: dto.costTier,
          sponsorName: dto.sponsorName,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          participantLimit: dto.participantLimit,
          milestones:
            dto.milestones === undefined
              ? Prisma.JsonNull
              : (dto.milestones as unknown as Prisma.InputJsonValue),
          safetyNotice: dto.safetyNotice,
          iconKey: dto.iconKey,
          status: MissionStatus.Draft,
          isActive: false,
          featured: false,
          createdByAdminId: ctx.actorAdminUserId,
        },
      }),
    );

    await this.recordAudit('challenges.create', mission.id, ctx, {
      previous: null,
      next: { title: mission.title, status: mission.status },
      reason: null,
    });
    this.logger.log(`Mission ${mission.id} created (Draft) by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(mission);
  }

  /**
   * Edits content/authoring fields. Lifecycle fields are untouched here (they
   * move only via the dedicated actions). If the edited mission is currently in
   * the live pool (`isActive`), the generator cache is invalidated so the change
   * is reflected immediately.
   */
  async update(
    id: string,
    dto: UpdateMissionDto,
    ctx: AdminMissionActionContext,
  ): Promise<AdminMissionDetailDto> {
    const existing = await this.findActive(id);
    this.assertDateWindow(
      dto.startDate ?? existing.startDate?.toISOString(),
      dto.endDate ?? existing.endDate?.toISOString(),
    );

    const updated = await this.runUniqueTitle(() =>
      this.prisma.mission.update({
        where: { id },
        data: {
          ...this.contentData(dto),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
        },
      }),
    );

    if (existing.isActive || updated.isActive) {
      await this.invalidatePool();
    }
    await this.recordAudit('challenges.edit', id, ctx, {
      previous: { title: existing.title, status: existing.status },
      next: { updatedFields: Object.keys(dto) },
      reason: null,
    });
    this.logger.log(`Mission ${id} updated by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(updated);
  }

  /**
   * Publishes a mission: `Published` + `isActive: true` + approval stamp. This is
   * also the "approve" action (Missions have no separate submission queue). Locks
   * the row so a concurrent publish/unpublish can't race the transition. 409 if
   * the mission is already published.
   */
  async publish(
    id: string,
    ctx: AdminMissionActionContext,
    reason: string | null = null,
  ): Promise<AdminMissionDetailDto> {
    const updated = await this.transition(id, (row) => {
      if (row.status === MissionStatus.Published) {
        throw new ConflictException('Mission is already published');
      }
      return {
        status: MissionStatus.Published,
        isActive: true,
        approvedAt: new Date(),
        approvedByAdminId: ctx.actorAdminUserId,
      };
    });

    await this.invalidatePool();
    await this.recordAudit('challenges.publish', id, ctx, {
      previous: { status: 'unpublished' },
      next: { status: MissionStatus.Published, isActive: true },
      reason,
    });
    this.logger.log(`Mission ${id} published by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(updated);
  }

  /**
   * Unpublishes a published mission back to `Draft` + `isActive: false`, clearing
   * the approval stamp. Drops it from the generator without touching any
   * `Completion`/`SavedMission` rows. 409 if the mission is not currently
   * published.
   */
  async unpublish(
    id: string,
    ctx: AdminMissionActionContext,
    reason: string | null = null,
  ): Promise<AdminMissionDetailDto> {
    const updated = await this.transition(id, (row) => {
      if (row.status !== MissionStatus.Published) {
        throw new ConflictException('Only a published mission can be unpublished');
      }
      return {
        status: MissionStatus.Draft,
        isActive: false,
        approvedAt: null,
        approvedByAdminId: null,
      };
    });

    await this.invalidatePool();
    await this.recordAudit('challenges.unpublish', id, ctx, {
      previous: { status: MissionStatus.Published, isActive: true },
      next: { status: MissionStatus.Draft, isActive: false },
      reason,
    });
    this.logger.log(`Mission ${id} unpublished by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(updated);
  }

  /**
   * Archives a mission (`Archived` + `isActive: false`), dropping it from the
   * generator while preserving history. 409 if already archived. The approval
   * stamp is left intact as an audit trail of its prior publication.
   */
  async archive(
    id: string,
    ctx: AdminMissionActionContext,
    reason: string | null = null,
  ): Promise<AdminMissionDetailDto> {
    const updated = await this.transition(id, (row) => {
      if (row.status === MissionStatus.Archived) {
        throw new ConflictException('Mission is already archived');
      }
      return { status: MissionStatus.Archived, isActive: false };
    });

    await this.invalidatePool();
    await this.recordAudit('challenges.archive', id, ctx, {
      previous: { isActive: true },
      next: { status: MissionStatus.Archived, isActive: false },
      reason,
    });
    this.logger.log(`Mission ${id} archived by admin ${ctx.actorAdminUserId}`);
    return this.buildDetail(updated);
  }

  /** Sets/clears the `featured` flag. Does not affect generator visibility. */
  async setFeatured(
    id: string,
    featured: boolean,
    ctx: AdminMissionActionContext,
    reason: string | null = null,
  ): Promise<AdminMissionDetailDto> {
    const existing = await this.findActive(id);
    const updated = await this.prisma.mission.update({
      where: { id },
      data: { featured },
    });

    await this.recordAudit('challenges.feature', id, ctx, {
      previous: { featured: existing.featured },
      next: { featured },
      reason,
    });
    this.logger.log(
      `Mission ${id} ${featured ? 'featured' : 'unfeatured'} by admin ${ctx.actorAdminUserId}`,
    );
    return this.buildDetail(updated);
  }

  /**
   * Clones a mission as a fresh `Draft`: new id, an available `(Copy)`-suffixed
   * title, authored by the caller, approval fields cleared, `featured: false`,
   * `isActive: false`. The clone is invisible to the generator until published.
   */
  async duplicate(
    id: string,
    ctx: AdminMissionActionContext,
    reason: string | null = null,
  ): Promise<AdminMissionDetailDto> {
    const source = await this.findActive(id);
    const title = await this.findAvailableCopyTitle(source.title);

    const clone = await this.prisma.mission.create({
      data: {
        title,
        category: source.category,
        description: source.description,
        fullBrief: source.fullBrief,
        proofRequirement: source.proofRequirement,
        estimatedMinutes: source.estimatedMinutes,
        xpReward: source.xpReward,
        difficulty: source.difficulty,
        difficultyDots: source.difficultyDots,
        crewTags: source.crewTags,
        settingTags: source.settingTags,
        costTier: source.costTier,
        sponsorName: source.sponsorName,
        startDate: source.startDate,
        endDate: source.endDate,
        participantLimit: source.participantLimit,
        milestones: this.cloneJson(source.milestones),
        safetyNotice: source.safetyNotice,
        iconKey: source.iconKey,
        status: MissionStatus.Draft,
        isActive: false,
        featured: false,
        approvedAt: null,
        approvedByAdminId: null,
        createdByAdminId: ctx.actorAdminUserId,
      },
    });

    await this.recordAudit('challenges.create', clone.id, ctx, {
      previous: { duplicatedFromMissionId: source.id },
      next: { title: clone.title, status: clone.status },
      reason: reason ?? 'duplicated',
    });
    this.logger.log(
      `Mission ${source.id} duplicated to ${clone.id} by admin ${ctx.actorAdminUserId}`,
    );
    return this.buildDetail(clone);
  }

  /**
   * Soft-deletes a mission (`deletedAt` set, `isActive: false`). Never
   * hard-deletes and never cascades: existing `Completion`/`SavedMission` rows
   * keep referencing the still-present row. Idempotent from the caller's view —
   * a second delete of an already-deleted mission is a 404. Locks the row so a
   * concurrent publish can't resurrect visibility mid-delete.
   */
  async remove(
    id: string,
    ctx: AdminMissionActionContext,
    reason: string | null = null,
  ): Promise<void> {
    const wasActive = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<LockedMissionRow[]>`
        SELECT id, status, "isActive", "deletedAt"
        FROM missions
        WHERE id = ${id}
        FOR UPDATE`;
      if (!row || row.deletedAt) {
        throw new NotFoundException('Mission not found');
      }
      await tx.mission.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return row.isActive;
    });

    if (wasActive) {
      await this.invalidatePool();
    }
    await this.recordAudit('challenges.delete', id, ctx, {
      previous: { deleted: false },
      next: { deleted: true },
      reason,
    });
    this.logger.log(`Mission ${id} soft-deleted by admin ${ctx.actorAdminUserId}`);
  }

  // --- internals ---------------------------------------------------------

  /**
   * Loads a lifecycle row under `SELECT ... FOR UPDATE`, applies the caller's
   * transition (which may throw a 409), and writes it — all in one transaction so
   * two concurrent lifecycle calls serialize rather than race.
   */
  private async transition(
    id: string,
    decide: (row: LockedMissionRow) => Prisma.MissionUpdateInput,
  ): Promise<Mission> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<LockedMissionRow[]>`
        SELECT id, status, "isActive", "deletedAt"
        FROM missions
        WHERE id = ${id}
        FOR UPDATE`;
      if (!row || row.deletedAt) {
        throw new NotFoundException('Mission not found');
      }
      const data = decide(row);
      return tx.mission.update({ where: { id }, data });
    });
  }

  private async findActive(id: string): Promise<Mission> {
    const mission = await this.prisma.mission.findFirst({ where: { id, deletedAt: null } });
    if (!mission) {
      throw new NotFoundException('Mission not found');
    }
    return mission;
  }

  private buildListWhere(query: ListMissionsQueryDto): Prisma.MissionWhereInput {
    const where: Prisma.MissionWhereInput = { deletedAt: null };
    if (query.status !== undefined) where.status = query.status;
    if (query.category !== undefined) where.category = query.category;
    if (query.difficulty !== undefined) where.difficulty = query.difficulty;
    if (query.featured !== undefined) where.featured = query.featured;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    return where;
  }

  /** Completion counts for a set of mission ids, as a `{ [missionId]: count }` map. */
  private async completionCounts(missionIds: string[]): Promise<Record<string, number>> {
    if (missionIds.length === 0) return {};
    const grouped = await this.prisma.completion.groupBy({
      by: ['missionId'],
      where: { missionId: { in: missionIds } },
      _count: { _all: true },
    });
    return grouped.reduce<Record<string, number>>((acc, row) => {
      acc[row.missionId] = row._count._all;
      return acc;
    }, {});
  }

  /** Builds the content/authoring portion of an update payload (all optional). */
  private contentData(dto: UpdateMissionDto): Prisma.MissionUncheckedUpdateInput {
    const data: Prisma.MissionUncheckedUpdateInput = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.fullBrief !== undefined) data.fullBrief = dto.fullBrief;
    if (dto.proofRequirement !== undefined) data.proofRequirement = dto.proofRequirement;
    if (dto.estimatedMinutes !== undefined) data.estimatedMinutes = dto.estimatedMinutes;
    if (dto.xpReward !== undefined) data.xpReward = dto.xpReward;
    if (dto.difficultyDots !== undefined) data.difficultyDots = dto.difficultyDots;
    if (dto.crewTags !== undefined) data.crewTags = dto.crewTags;
    if (dto.settingTags !== undefined) data.settingTags = dto.settingTags;
    if (dto.costTier !== undefined) data.costTier = dto.costTier;
    if (dto.sponsorName !== undefined) data.sponsorName = dto.sponsorName;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.participantLimit !== undefined) data.participantLimit = dto.participantLimit;
    if (dto.milestones !== undefined) {
      data.milestones = dto.milestones as unknown as Prisma.InputJsonValue;
    }
    if (dto.safetyNotice !== undefined) data.safetyNotice = dto.safetyNotice;
    if (dto.iconKey !== undefined) data.iconKey = dto.iconKey;
    return data;
  }

  /** Rejects a start/end window where the end precedes the start. */
  private assertDateWindow(start?: string | null, end?: string | null): void {
    if (start && end && new Date(start).getTime() > new Date(end).getTime()) {
      throw new BadRequestException('startDate must be on or before endDate');
    }
  }

  /** Finds an unused `(Copy)`-suffixed title so the unique constraint won't trip. */
  private async findAvailableCopyTitle(base: string): Promise<string> {
    for (let attempt = 1; attempt <= MAX_DUPLICATE_ATTEMPTS; attempt++) {
      const candidate = attempt === 1 ? `${base} (Copy)` : `${base} (Copy ${attempt})`;
      const clash = await this.prisma.mission.findUnique({
        where: { title: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    // Fall back to a guaranteed-unique suffix rather than looping forever.
    return `${base} (Copy ${Date.now()})`;
  }

  /** Deep-clones a Prisma JSON value for the duplicate flow (null-safe). */
  private cloneJson(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  /**
   * Runs a create/update and maps the `Mission.title` unique-constraint violation
   * (Prisma P2002) to a 409 instead of a raw 500.
   */
  private async runUniqueTitle<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A mission with this title already exists');
      }
      throw error;
    }
  }

  private async invalidatePool(): Promise<void> {
    await this.missionPool.invalidate();
  }

  private toListItem(mission: Mission, completionCount: number): AdminMissionListItemDto {
    return {
      id: mission.id,
      title: mission.title,
      category: mission.category,
      difficulty: mission.difficulty,
      status: mission.status,
      isActive: mission.isActive,
      featured: mission.featured,
      xpReward: mission.xpReward,
      estimatedMinutes: mission.estimatedMinutes,
      sponsorName: mission.sponsorName,
      completionCount,
      approvedAt: mission.approvedAt,
      updatedAt: mission.updatedAt,
      createdAt: mission.createdAt,
    };
  }

  private async buildDetail(mission: Mission): Promise<AdminMissionDetailDto> {
    const [completionCount, savedCount] = await Promise.all([
      this.prisma.completion.count({ where: { missionId: mission.id } }),
      this.prisma.savedMission.count({ where: { missionId: mission.id } }),
    ]);

    return {
      id: mission.id,
      title: mission.title,
      category: mission.category,
      description: mission.description,
      fullBrief: mission.fullBrief,
      proofRequirement: mission.proofRequirement,
      estimatedMinutes: mission.estimatedMinutes,
      xpReward: mission.xpReward,
      difficulty: mission.difficulty,
      difficultyDots: mission.difficultyDots,
      crewTags: mission.crewTags,
      settingTags: mission.settingTags,
      costTier: mission.costTier,
      status: mission.status,
      isActive: mission.isActive,
      featured: mission.featured,
      sponsorName: mission.sponsorName,
      startDate: mission.startDate,
      endDate: mission.endDate,
      participantLimit: mission.participantLimit,
      milestones: mission.milestones,
      safetyNotice: mission.safetyNotice,
      iconKey: mission.iconKey,
      createdByAdminId: mission.createdByAdminId,
      approvedByAdminId: mission.approvedByAdminId,
      approvedAt: mission.approvedAt,
      completionCount,
      savedCount,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
    };
  }

  /** Best-effort audit write (same convention as the other admin modules). */
  private async recordAudit(
    action: string,
    missionId: string,
    ctx: AdminMissionActionContext,
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
      targetId: missionId,
      previousValue: (payload.previous ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (payload.next ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      result: AuditResult.Success,
      reason: payload.reason,
    });
  }
}
