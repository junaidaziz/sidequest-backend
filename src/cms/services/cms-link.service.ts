import { Injectable } from '@nestjs/common';
import { CmsLink } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsLinkDto } from '../dto/cms-response.dto';
import { CreateCmsLinkDto, UpdateCmsLinkDto } from '../dto/cms-content.dto';
import { CmsDelegate } from '../types/cms.types';
import { CmsCacheService } from './cms-cache.service';
import { CmsResourceService } from './cms-resource.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/** Managed nav / footer / social / legal links. No `publishedAt` column. */
@Injectable()
export class CmsLinkService extends CmsResourceService<
  CmsLink,
  CmsLinkDto,
  CreateCmsLinkDto,
  UpdateCmsLinkDto
> {
  protected readonly delegate = this.prisma.cmsLink as unknown as CmsDelegate<CmsLink>;
  protected readonly targetType = 'CmsLink';
  protected readonly cacheTag = CMS_CACHE_TAGS.links;
  protected readonly hasPublishedAt = false;
  protected readonly hasSortOrder = true;

  constructor(
    prisma: PrismaService,
    audit: AuditLogService,
    cache: CmsCacheService,
    revalidation: CmsRevalidationService,
  ) {
    super(prisma, audit, cache, revalidation);
  }

  protected async buildCreateData(input: CreateCmsLinkDto): Promise<Record<string, unknown>> {
    return {
      placement: input.placement,
      label: input.label,
      url: input.url,
      openInNewTab: input.openInNewTab ?? false,
      sortOrder: input.sortOrder ?? 0,
    };
  }

  protected async buildUpdateData(input: UpdateCmsLinkDto): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    if (input.placement !== undefined) data.placement = input.placement;
    if (input.label !== undefined) data.label = input.label;
    if (input.url !== undefined) data.url = input.url;
    if (input.openInNewTab !== undefined) data.openInNewTab = input.openInNewTab;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    return data;
  }

  protected async toAdminDto(e: CmsLink): Promise<CmsLinkDto> {
    return {
      id: e.id,
      placement: e.placement,
      label: e.label,
      url: e.url,
      openInNewTab: e.openInNewTab,
      sortOrder: e.sortOrder,
      status: e.status,
      publishedAt: null,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
