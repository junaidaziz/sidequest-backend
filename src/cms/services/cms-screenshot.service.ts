import { BadRequestException, Injectable } from '@nestjs/common';
import { CmsScreenshot } from '@prisma/client';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsScreenshotDto } from '../dto/cms-response.dto';
import { CreateCmsScreenshotDto, UpdateCmsScreenshotDto } from '../dto/cms-content.dto';
import { CmsDelegate, CmsRequestContext } from '../types/cms.types';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsResourceService } from './cms-resource.service';
import { CmsRevalidationService } from './cms-revalidation.service';

/**
 * App screenshots. `imageKey` is required, so creation is a multipart request
 * carrying the image itself (createWithImage), not a plain JSON body.
 */
@Injectable()
export class CmsScreenshotService extends CmsResourceService<
  CmsScreenshot,
  CmsScreenshotDto,
  CreateCmsScreenshotDto,
  UpdateCmsScreenshotDto
> {
  protected readonly delegate = this.prisma.cmsScreenshot as unknown as CmsDelegate<CmsScreenshot>;
  protected readonly targetType = 'CmsScreenshot';
  protected readonly cacheTag = CMS_CACHE_TAGS.screenshots;
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

  // The image is mandatory, so the base create() (JSON-only) is not used — it
  // would violate the NOT NULL imageKey. buildCreateData exists to satisfy the
  // abstract contract and is intentionally never reached for screenshots.
  protected async buildCreateData(): Promise<Record<string, unknown>> {
    throw new BadRequestException('Screenshots must be created with an image via createWithImage');
  }

  protected async buildUpdateData(input: UpdateCmsScreenshotDto): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.caption !== undefined) data.caption = input.caption;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    return data;
  }

  /** Creates a screenshot from a multipart image + metadata. */
  async createWithImage(
    actor: AuthAdmin,
    dto: CreateCmsScreenshotDto,
    file: Express.Multer.File,
    ctx: CmsRequestContext,
  ): Promise<CmsScreenshotDto> {
    const imageKey = await this.assets.store('screenshots', file);
    return this.persistCreate(
      actor,
      {
        title: dto.title ?? null,
        caption: dto.caption ?? null,
        imageKey,
        sortOrder: dto.sortOrder ?? 0,
      },
      ctx,
    );
  }

  /** Replaces the screenshot image, cleaning up the previous object best-effort. */
  async replaceImage(
    actor: AuthAdmin,
    id: string,
    file: Express.Multer.File,
    ctx: CmsRequestContext,
  ): Promise<CmsScreenshotDto> {
    const existing = await this.findActive(id);
    const newKey = await this.assets.store('screenshots', file);
    const dto = await this.persistPatch(
      actor,
      existing,
      { imageKey: newKey },
      ctx,
      'replace_image',
    );
    if (existing.imageKey && existing.imageKey !== newKey) {
      await this.assets.remove(existing.imageKey).catch(() => undefined);
    }
    return dto;
  }

  protected async toAdminDto(e: CmsScreenshot): Promise<CmsScreenshotDto> {
    return {
      id: e.id,
      title: e.title,
      caption: e.caption,
      imageKey: e.imageKey,
      imageUrl: await this.assets.resolveUrl(e.imageKey),
      sortOrder: e.sortOrder,
      status: e.status,
      publishedAt: e.publishedAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
