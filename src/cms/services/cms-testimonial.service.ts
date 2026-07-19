import { Injectable } from '@nestjs/common';
import { CmsTestimonial } from '@prisma/client';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsTestimonialDto } from '../dto/cms-response.dto';
import { CreateCmsTestimonialDto, UpdateCmsTestimonialDto } from '../dto/cms-content.dto';
import { CmsDelegate, CmsRequestContext } from '../types/cms.types';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsResourceService } from './cms-resource.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/** Customer testimonials, with an optional (sanitized) avatar image. */
@Injectable()
export class CmsTestimonialService extends CmsResourceService<
  CmsTestimonial,
  CmsTestimonialDto,
  CreateCmsTestimonialDto,
  UpdateCmsTestimonialDto
> {
  protected readonly delegate = this.prisma
    .cmsTestimonial as unknown as CmsDelegate<CmsTestimonial>;
  protected readonly targetType = 'CmsTestimonial';
  protected readonly cacheTag = CMS_CACHE_TAGS.testimonials;
  protected readonly hasPublishedAt = true;
  protected readonly hasSortOrder = true;

  constructor(
    prisma: PrismaService,
    audit: AuditLogService,
    cache: CmsCacheService,
    revalidation: CmsRevalidationService,
    private readonly assets: CmsAssetService,
  ) {
    super(prisma, audit, cache, revalidation);
  }

  protected async buildCreateData(
    input: CreateCmsTestimonialDto,
  ): Promise<Record<string, unknown>> {
    return {
      authorName: input.authorName,
      authorTitle: input.authorTitle ?? null,
      quote: input.quote,
      rating: input.rating ?? null,
      sortOrder: input.sortOrder ?? 0,
    };
  }

  protected async buildUpdateData(
    input: UpdateCmsTestimonialDto,
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    if (input.authorName !== undefined) data.authorName = input.authorName;
    if (input.authorTitle !== undefined) data.authorTitle = input.authorTitle;
    if (input.quote !== undefined) data.quote = input.quote;
    if (input.rating !== undefined) data.rating = input.rating;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    return data;
  }

  /** Uploads (and sanitizes, if SVG) a new avatar, replacing any existing one. */
  async setAvatar(
    actor: AuthAdmin,
    id: string,
    file: Express.Multer.File,
    ctx: CmsRequestContext,
  ): Promise<CmsTestimonialDto> {
    const existing = await this.findActive(id);
    const newKey = await this.assets.store('testimonials', file);
    const dto = await this.persistPatch(actor, existing, { avatarKey: newKey }, ctx, 'set_avatar');
    // Best-effort cleanup of the replaced object — never blocks the committed write.
    if (existing.avatarKey && existing.avatarKey !== newKey) {
      await this.assets.remove(existing.avatarKey).catch(() => undefined);
    }
    return dto;
  }

  protected async toAdminDto(e: CmsTestimonial): Promise<CmsTestimonialDto> {
    return {
      id: e.id,
      authorName: e.authorName,
      authorTitle: e.authorTitle,
      quote: e.quote,
      avatarKey: e.avatarKey,
      avatarUrl: await this.assets.resolveUrl(e.avatarKey),
      rating: e.rating,
      sortOrder: e.sortOrder,
      status: e.status,
      publishedAt: e.publishedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
