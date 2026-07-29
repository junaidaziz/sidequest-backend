import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MissionTag, Prisma } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMissionTagDto } from './dto/create-mission-tag.dto';
import { ListMissionTagsQueryDto } from './dto/list-mission-tags-query.dto';
import { MissionTagDto, MissionTagListDto } from './dto/mission-tag-response.dto';
import { UpdateMissionTagDto } from './dto/update-mission-tag.dto';

/** Per-request audit context threaded from the controller (acting admin + IP/UA). */
export interface MissionTagActionContext {
  actorAdminUserId: string;
  ipAddress: string;
  userAgent: string | null;
}

/**
 * Admin-managed CRUD for the mission crew/setting tag vocabulary (closed-beta
 * admin tooling). Owns all business rules; the controller is thin. Tags are
 * deactivated rather than hard-deleted (a value may still be referenced by
 * existing missions' `crewTags`/`settingTags` arrays), so there is no delete
 * that removes a row.
 */
@Injectable()
export class AdminMissionTagsService {
  private readonly logger = new Logger(AdminMissionTagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Lists tags, ordered by (type, sortOrder, value). Active-only unless asked otherwise. */
  async list(query: ListMissionTagsQueryDto): Promise<MissionTagListDto> {
    const where: Prisma.MissionTagWhereInput = {};
    if (query.type) {
      where.type = query.type;
    }
    if (!query.includeInactive) {
      where.isActive = true;
    }

    const rows = await this.prisma.missionTag.findMany({
      where,
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { value: 'asc' }],
    });
    return { items: rows.map(MissionTagDto.fromEntity), total: rows.length };
  }

  /** Creates a tag. A duplicate (type, value) is a 409, not a 500. */
  async create(dto: CreateMissionTagDto, ctx: MissionTagActionContext): Promise<MissionTagDto> {
    try {
      const tag = await this.prisma.missionTag.create({
        data: {
          type: dto.type,
          value: dto.value,
          label: dto.label,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
      await this.recordAudit('challenges.tags.create', tag.id, ctx, null, {
        type: tag.type,
        value: tag.value,
      });
      this.logger.log(`Mission tag ${tag.id} (${tag.type}/${tag.value}) created`);
      return MissionTagDto.fromEntity(tag);
    } catch (error) {
      if (this.isDuplicate(error)) {
        throw new ConflictException(`A ${dto.type} tag with value "${dto.value}" already exists`);
      }
      throw error;
    }
  }

  /** Edits a tag's mutable fields. 404 if missing; 409 if a value rename collides. */
  async update(
    id: string,
    dto: UpdateMissionTagDto,
    ctx: MissionTagActionContext,
  ): Promise<MissionTagDto> {
    const existing = await this.mustFind(id);

    const data: Prisma.MissionTagUpdateInput = {};
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const tag = await this.prisma.missionTag.update({ where: { id }, data });
      await this.recordAudit(
        'challenges.tags.update',
        id,
        ctx,
        {
          value: existing.value,
          label: existing.label,
          isActive: existing.isActive,
          sortOrder: existing.sortOrder,
        },
        { value: tag.value, label: tag.label, isActive: tag.isActive, sortOrder: tag.sortOrder },
      );
      this.logger.log(`Mission tag ${id} updated`);
      return MissionTagDto.fromEntity(tag);
    } catch (error) {
      if (this.isDuplicate(error)) {
        throw new ConflictException(
          `A ${existing.type} tag with value "${dto.value}" already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Deactivates a tag (isActive = false) rather than hard-deleting it, so a value
   * still referenced by existing missions keeps rendering. Idempotent: a
   * re-deactivate is a no-op that still returns the tag. 404 if the tag id is
   * unknown.
   */
  async deactivate(id: string, ctx: MissionTagActionContext): Promise<MissionTagDto> {
    const existing = await this.mustFind(id);
    if (!existing.isActive) {
      return MissionTagDto.fromEntity(existing);
    }
    const tag = await this.prisma.missionTag.update({
      where: { id },
      data: { isActive: false },
    });
    await this.recordAudit(
      'challenges.tags.deactivate',
      id,
      ctx,
      { isActive: true },
      { isActive: false },
    );
    this.logger.log(`Mission tag ${id} deactivated`);
    return MissionTagDto.fromEntity(tag);
  }

  private async mustFind(id: string): Promise<MissionTag> {
    const tag = await this.prisma.missionTag.findUnique({ where: { id } });
    if (!tag) {
      throw new NotFoundException('Mission tag not found');
    }
    return tag;
  }

  private isDuplicate(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  /** Best-effort audit write (same convention as the other admin modules). */
  private async recordAudit(
    action: string,
    targetId: string,
    ctx: MissionTagActionContext,
    previousValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
  ): Promise<void> {
    await this.audit.record({
      actorAdminUserId: ctx.actorAdminUserId,
      action,
      targetType: 'MissionTag',
      targetId,
      previousValue: (previousValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      result: AuditResult.Success,
    });
  }
}
