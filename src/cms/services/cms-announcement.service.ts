import { Injectable } from '@nestjs/common';
import { CmsAnnouncement, Prisma } from '@prisma/client';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsAnnouncementDto } from '../dto/cms-response.dto';
import { CreateCmsAnnouncementDto, UpdateCmsAnnouncementDto } from '../dto/cms-content.dto';
import { CmsDelegate, CmsRequestContext } from '../types/cms.types';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsResourceService } from './cms-resource.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/** Blog posts / product announcements / safety notices (discriminated by `kind`). */
@Injectable()
export class CmsAnnouncementService extends CmsResourceService<
  CmsAnnouncement,
  CmsAnnouncementDto,
  CreateCmsAnnouncementDto,
  UpdateCmsAnnouncementDto
> {
  protected readonly delegate = this.prisma
    .cmsAnnouncement as unknown as CmsDelegate<CmsAnnouncement>;
  protected readonly targetType = 'CmsAnnouncement';
  protected readonly cacheTag = CMS_CACHE_TAGS.announcements;
  protected readonly hasPublishedAt = true;
  protected readonly hasSortOrder = false;

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
    input: CreateCmsAnnouncementDto,
  ): Promise<Record<string, unknown>> {
    return {
      kind: input.kind,
      slug: input.slug,
      title: input.title,
      excerpt: input.excerpt ?? null,
      body: input.body as unknown as Prisma.InputJsonValue,
    };
  }

  protected async buildUpdateData(
    input: UpdateCmsAnnouncementDto,
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.title !== undefined) data.title = input.title;
    if (input.excerpt !== undefined) data.excerpt = input.excerpt;
    if (input.body !== undefined) data.body = input.body as unknown as Prisma.InputJsonValue;
    return data;
  }

  /** Uploads (and sanitizes, if SVG) a cover image, replacing any existing one. */
  async setCover(
    actor: AuthAdmin,
    id: string,
    file: Express.Multer.File,
    ctx: CmsRequestContext,
  ): Promise<CmsAnnouncementDto> {
    const existing = await this.findActive(id);
    const newKey = await this.assets.store('announcements', file);
    const dto = await this.persistPatch(
      actor,
      existing,
      { coverImageKey: newKey },
      ctx,
      'set_cover',
    );
    if (existing.coverImageKey && existing.coverImageKey !== newKey) {
      await this.assets.remove(existing.coverImageKey).catch(() => undefined);
    }
    return dto;
  }

  protected async toAdminDto(e: CmsAnnouncement): Promise<CmsAnnouncementDto> {
    return {
      id: e.id,
      kind: e.kind,
      slug: e.slug,
      title: e.title,
      excerpt: e.excerpt,
      body: e.body,
      coverImageKey: e.coverImageKey,
      coverImageUrl: await this.assets.resolveUrl(e.coverImageKey),
      status: e.status,
      publishedAt: e.publishedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
