import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditResult } from '../../audit-log/types/audit';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_REVALIDATE_TAG_PREFIX, CmsCacheTag } from '../cms.constants';
import { CmsDelegate, CmsMutableEntity, CmsRequestContext } from '../types/cms.types';
import { CmsCacheService } from './cms-cache.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/**
 * Generic base for every CMS content type. It owns the entire cross-cutting
 * shell — soft-delete, publish/unpublish state transitions, drag-to-reorder,
 * audit logging, public-cache invalidation, and best-effort revalidation — so
 * each concrete content service is reduced to the parts that actually differ:
 * its Prisma delegate, its field mapping (`buildCreateData`/`buildUpdateData`),
 * and its response shape (`toAdminDto`).
 *
 * Design notes:
 *  - Typed over `CreateDto`/`UpdateDto` so subclasses map an actual DTO type in
 *    `buildCreateData`/`buildUpdateData` — no `dto: unknown` double-cast at the
 *    most important data-shaping step.
 *  - `delegate` is a `CmsDelegate<E>` the subclass supplies via a single
 *    `as unknown as` cast of its concrete Prisma delegate — this keeps the base
 *    generic with zero use of `any`.
 *  - Creation always starts a row as Draft (schema default). Going public is a
 *    deliberate, separately-permissioned `cms.publish` action, never a side
 *    effect of an edit — this is what lets `cms.edit` and `cms.publish` be
 *    distinct capabilities per the RBAC catalog.
 *  - Every mutation and its audit write share a SINGLE `prisma.$transaction`, so a
 *    transient audit-write failure rolls the mutation back rather than leaving an
 *    un-audited content change committed. Cache-invalidation and the revalidation
 *    ping happen AFTER commit (best-effort, never fail the write).
 */
export abstract class CmsResourceService<
  E extends CmsMutableEntity,
  AdminDto,
  CreateDto = unknown,
  UpdateDto = unknown,
> {
  /** The subclass's Prisma delegate, structurally narrowed to CmsDelegate. */
  protected abstract readonly delegate: CmsDelegate<E>;
  /** Prisma model name, used as the audit `targetType` (e.g. "CmsFaq"). */
  protected abstract readonly targetType: string;
  /** Cache/revalidation tag for this content type (e.g. "faqs"). */
  protected abstract readonly cacheTag: CmsCacheTag;
  /** Whether the model has a `publishedAt` column to stamp on publish. */
  protected abstract readonly hasPublishedAt: boolean;
  /** Whether the model has a `sortOrder` column (i.e. supports reorder). */
  protected abstract readonly hasSortOrder: boolean;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditLogService,
    protected readonly cache: CmsCacheService,
    protected readonly revalidation: CmsRevalidationService,
  ) {}

  /** Maps a validated create DTO to Prisma create data (audit stamps added by base). */
  protected abstract buildCreateData(
    dto: CreateDto,
    actorId: string,
  ): Promise<Record<string, unknown>>;

  /** Maps a validated update DTO to a partial Prisma update payload. */
  protected abstract buildUpdateData(dto: UpdateDto, existing: E): Promise<Record<string, unknown>>;

  /** Maps a persisted entity to its admin response DTO (async: may presign assets). */
  protected abstract toAdminDto(entity: E): Promise<AdminDto>;

  /** Compact before/after snapshot stored in the audit trail. Overridable. */
  protected snapshot(entity: E): Record<string, unknown> {
    return { id: entity.id, status: entity.status };
  }

  private orderBy(): Array<Record<string, 'asc' | 'desc'>> {
    return this.hasSortOrder
      ? [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
      : [{ createdAt: 'desc' }];
  }

  /** Admin list — every non-deleted row, drafts included. */
  async list(): Promise<AdminDto[]> {
    const rows = await this.delegate.findMany({
      where: { deletedAt: null },
      orderBy: this.orderBy(),
    });
    return Promise.all(rows.map((row) => this.toAdminDto(row)));
  }

  async get(id: string): Promise<AdminDto> {
    return this.toAdminDto(await this.findActive(id));
  }

  protected async findActive(id: string): Promise<E> {
    const row = await this.delegate.findFirst({ where: { id, deletedAt: null } });
    if (!row) {
      throw new NotFoundException(`${this.targetType} not found`);
    }
    return row;
  }

  async create(actor: AuthAdmin, dto: CreateDto, ctx: CmsRequestContext): Promise<AdminDto> {
    const data = await this.buildCreateData(dto, actor.adminUserId);
    return this.persistCreate(actor, data, ctx);
  }

  /**
   * Persists prepared create data + its audit entry in one transaction. The row
   * id is generated up front so the audit `targetId` is known inside the same
   * transaction. Exposed so image content types can inject an already-uploaded
   * asset key alongside the DTO fields before the row is written.
   */
  protected async persistCreate(
    actor: AuthAdmin,
    data: Record<string, unknown>,
    ctx: CmsRequestContext,
  ): Promise<AdminDto> {
    const id = (data.id as string | undefined) ?? randomUUID();
    data.id = id;
    data.createdByAdminId = actor.adminUserId;
    data.updatedByAdminId = actor.adminUserId;
    const [row] = await this.runWrite(() =>
      this.prisma.$transaction([
        this.delegate.create({ data }),
        this.auditPromise(actor, 'cms.edit', 'create', id, null, { id }, ctx),
      ]),
    );
    await this.afterMutation();
    return this.toAdminDto(row);
  }

  async update(
    actor: AuthAdmin,
    id: string,
    dto: UpdateDto,
    ctx: CmsRequestContext,
  ): Promise<AdminDto> {
    const existing = await this.findActive(id);
    const data = await this.buildUpdateData(dto, existing);
    return this.persistPatch(actor, existing, data, ctx);
  }

  /**
   * Persists a partial update + its audit entry in one transaction. Exposed so
   * image content types can swap an asset key without going through the DTO path.
   */
  protected async persistPatch(
    actor: AuthAdmin,
    existing: E,
    data: Record<string, unknown>,
    ctx: CmsRequestContext,
    verb = 'update',
  ): Promise<AdminDto> {
    data.updatedByAdminId = actor.adminUserId;
    const [row] = await this.runWrite(() =>
      this.prisma.$transaction([
        this.delegate.update({ where: { id: existing.id }, data }),
        this.auditPromise(
          actor,
          'cms.edit',
          verb,
          existing.id,
          this.snapshot(existing),
          { id: existing.id },
          ctx,
        ),
      ]),
    );
    await this.afterMutation();
    return this.toAdminDto(row);
  }

  async remove(actor: AuthAdmin, id: string, ctx: CmsRequestContext): Promise<void> {
    const existing = await this.findActive(id);
    await this.prisma.$transaction([
      this.delegate.update({
        where: { id },
        data: { deletedAt: new Date(), updatedByAdminId: actor.adminUserId },
      }),
      this.auditPromise(actor, 'cms.edit', 'delete', id, this.snapshot(existing), null, ctx),
    ]);
    await this.afterMutation();
  }

  /**
   * Publish / unpublish. Gated by `cms.publish` at the controller (distinct from
   * the `cms.edit` that gates create/update). Stamps `publishedAt` on models that
   * carry it. Mutation + audit share one transaction.
   */
  async setPublished(
    actor: AuthAdmin,
    id: string,
    publish: boolean,
    ctx: CmsRequestContext,
  ): Promise<AdminDto> {
    const existing = await this.findActive(id);
    const nextStatus = publish ? 'Published' : 'Draft';
    const data: Record<string, unknown> = {
      status: nextStatus,
      updatedByAdminId: actor.adminUserId,
    };
    if (this.hasPublishedAt) {
      data.publishedAt = publish ? new Date() : null;
    }
    const [row] = await this.prisma.$transaction([
      this.delegate.update({ where: { id }, data }),
      this.auditPromise(
        actor,
        'cms.publish',
        publish ? 'publish' : 'unpublish',
        id,
        { status: existing.status },
        { status: nextStatus },
        ctx,
      ),
    ]);
    await this.afterMutation();
    return this.toAdminDto(row);
  }

  /**
   * Reorders a content type by assigning `sortOrder` from the given id sequence.
   * Rejects a set that doesn't correspond exactly to the live (non-deleted) rows
   * with those ids, so a stale or tampered list can't null out ordering. The row
   * updates and the audit entry are one atomic transaction.
   */
  async reorder(
    actor: AuthAdmin,
    orderedIds: string[],
    ctx: CmsRequestContext,
  ): Promise<AdminDto[]> {
    if (!this.hasSortOrder) {
      throw new BadRequestException(`${this.targetType} is not reorderable`);
    }
    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length) {
      throw new BadRequestException('Duplicate ids in reorder set');
    }
    const found = await this.delegate.findMany({
      where: { id: { in: orderedIds }, deletedAt: null },
    });
    if (found.length !== orderedIds.length) {
      throw new BadRequestException('Reorder set does not match the current items');
    }
    const writes = orderedIds.map((id, index) =>
      this.delegate.update({
        where: { id },
        data: { sortOrder: index, updatedByAdminId: actor.adminUserId },
      }),
    );
    await this.prisma.$transaction([
      ...writes,
      this.auditPromise(actor, 'cms.edit', 'reorder', null, null, { order: orderedIds }, ctx),
    ] as Prisma.PrismaPromise<unknown>[]);
    await this.afterMutation();
    return this.list();
  }

  /**
   * Wraps a create/update write to map a unique-constraint violation (a duplicate
   * slug/key) to a clean 409 rather than leaking a raw Prisma error.
   */
  protected async runWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`A ${this.targetType} with that unique field already exists`);
      }
      throw error;
    }
  }

  /** Drop the public cache for this type and best-effort revalidate the web app. */
  protected async afterMutation(extraTags: string[] = []): Promise<void> {
    await this.cache.invalidate(this.cacheTag);
    this.revalidation.trigger([`${CMS_REVALIDATE_TAG_PREFIX}${this.cacheTag}`, ...extraTags]);
  }

  /** Builds the un-awaited audit-insert PrismaPromise for enlistment in a transaction. */
  private auditPromise(
    actor: AuthAdmin,
    action: string,
    verb: string,
    targetId: string | null,
    previousValue: Record<string, unknown> | null,
    nextValue: Record<string, unknown> | null,
    ctx: CmsRequestContext,
  ): Prisma.PrismaPromise<unknown> {
    return this.audit.buildRecord({
      actorAdminUserId: actor.adminUserId,
      action,
      targetType: this.targetType,
      targetId,
      previousValue: (previousValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: { ...(nextValue ?? {}), __verb: verb } as unknown as Prisma.InputJsonValue,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
