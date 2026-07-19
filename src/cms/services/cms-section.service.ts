import { Injectable } from '@nestjs/common';
import { CmsSection, Prisma } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsSectionDto } from '../dto/cms-response.dto';
import { CreateCmsSectionDto, UpdateCmsSectionDto } from '../dto/cms-content.dto';
import { CmsDelegate } from '../types/cms.types';
import { CmsCacheService } from './cms-cache.service';
import { CmsResourceService } from './cms-resource.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/**
 * Typed homepage/feature sections. The `data` payload has already been validated
 * against its `type` by IsValidSectionData at the DTO boundary, so by the time it
 * reaches here it is a known-safe structured shape — never freeform JSON.
 */
@Injectable()
export class CmsSectionService extends CmsResourceService<CmsSection, CmsSectionDto> {
  protected readonly delegate = this.prisma.cmsSection as unknown as CmsDelegate<CmsSection>;
  protected readonly targetType = 'CmsSection';
  protected readonly cacheTag = CMS_CACHE_TAGS.sections;
  protected readonly hasPublishedAt = true;
  protected readonly hasSortOrder = true;

  constructor(
    prisma: PrismaService,
    audit: AuditLogService,
    cache: CmsCacheService,
    revalidation: CmsRevalidationService,
  ) {
    super(prisma, audit, cache, revalidation);
  }

  protected async buildCreateData(dto: unknown): Promise<Record<string, unknown>> {
    const input = dto as CreateCmsSectionDto;
    return {
      key: input.key,
      type: input.type,
      title: input.title ?? null,
      data: input.data as Prisma.InputJsonValue,
      sortOrder: input.sortOrder ?? 0,
    };
  }

  protected async buildUpdateData(dto: unknown): Promise<Record<string, unknown>> {
    const input = dto as UpdateCmsSectionDto;
    const data: Record<string, unknown> = {};
    if (input.key !== undefined) data.key = input.key;
    if (input.type !== undefined) data.type = input.type;
    if (input.title !== undefined) data.title = input.title;
    if (input.data !== undefined) data.data = input.data as Prisma.InputJsonValue;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    return data;
  }

  protected async toAdminDto(e: CmsSection): Promise<CmsSectionDto> {
    return {
      id: e.id,
      key: e.key,
      type: e.type,
      title: e.title,
      data: e.data,
      sortOrder: e.sortOrder,
      status: e.status,
      publishedAt: e.publishedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
