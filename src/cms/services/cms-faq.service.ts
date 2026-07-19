import { Injectable } from '@nestjs/common';
import { CmsFaq } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsFaqDto } from '../dto/cms-response.dto';
import { CreateCmsFaqDto, UpdateCmsFaqDto } from '../dto/cms-content.dto';
import { CmsDelegate } from '../types/cms.types';
import { CmsCacheService } from './cms-cache.service';
import { CmsResourceService } from './cms-resource.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/** Frequently-asked-questions content type. */
@Injectable()
export class CmsFaqService extends CmsResourceService<
  CmsFaq,
  CmsFaqDto,
  CreateCmsFaqDto,
  UpdateCmsFaqDto
> {
  protected readonly delegate = this.prisma.cmsFaq as unknown as CmsDelegate<CmsFaq>;
  protected readonly targetType = 'CmsFaq';
  protected readonly cacheTag = CMS_CACHE_TAGS.faqs;
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

  protected async buildCreateData(input: CreateCmsFaqDto): Promise<Record<string, unknown>> {
    return {
      question: input.question,
      answer: input.answer,
      category: input.category ?? null,
      sortOrder: input.sortOrder ?? 0,
    };
  }

  protected async buildUpdateData(input: UpdateCmsFaqDto): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    if (input.question !== undefined) data.question = input.question;
    if (input.answer !== undefined) data.answer = input.answer;
    if (input.category !== undefined) data.category = input.category;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    return data;
  }

  protected async toAdminDto(e: CmsFaq): Promise<CmsFaqDto> {
    return {
      id: e.id,
      question: e.question,
      answer: e.answer,
      category: e.category,
      sortOrder: e.sortOrder,
      status: e.status,
      publishedAt: e.publishedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
