import { Injectable } from '@nestjs/common';
import { CmsPage, Prisma } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsPageDto } from '../dto/cms-response.dto';
import { CreateCmsPageDto, UpdateCmsPageDto } from '../dto/cms-content.dto';
import { CmsDelegate } from '../types/cms.types';
import { CmsCacheService } from './cms-cache.service';
import { CmsResourceService } from './cms-resource.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/** About / Legal / Help / Contact / Safety long-form pages (slug-addressed). */
@Injectable()
export class CmsPageService extends CmsResourceService<
  CmsPage,
  CmsPageDto,
  CreateCmsPageDto,
  UpdateCmsPageDto
> {
  protected readonly delegate = this.prisma.cmsPage as unknown as CmsDelegate<CmsPage>;
  protected readonly targetType = 'CmsPage';
  protected readonly cacheTag = CMS_CACHE_TAGS.pages;
  protected readonly hasPublishedAt = true;
  protected readonly hasSortOrder = false;

  // An explicit constructor is required (not just inherited) so TypeScript emits
  // `design:paramtypes` for Nest's DI — an @Injectable subclass with no own
  // constructor would otherwise be instantiated with zero dependencies.
  constructor(
    prisma: PrismaService,
    audit: AuditLogService,
    cache: CmsCacheService,
    revalidation: CmsRevalidationService,
  ) {
    super(prisma, audit, cache, revalidation);
  }

  protected async buildCreateData(input: CreateCmsPageDto): Promise<Record<string, unknown>> {
    return {
      slug: input.slug,
      title: input.title,
      body: input.body as unknown as Prisma.InputJsonValue,
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
    };
  }

  protected async buildUpdateData(input: UpdateCmsPageDto): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body as unknown as Prisma.InputJsonValue;
    if (input.metaTitle !== undefined) data.metaTitle = input.metaTitle;
    if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription;
    return data;
  }

  protected async toAdminDto(e: CmsPage): Promise<CmsPageDto> {
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      body: e.body,
      metaTitle: e.metaTitle,
      metaDescription: e.metaDescription,
      status: e.status,
      publishedAt: e.publishedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
