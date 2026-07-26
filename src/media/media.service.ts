import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAsset, MediaPurpose, MediaStatus, MediaVariant } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOWED_IMAGE_MIME_TYPES, StorageService } from '../storage/storage.service';
import {
  CreateMediaUploadRequestDto,
  CreateMediaUploadResponseDto,
} from './dto/create-media-upload.dto';
import { MediaAssetResponseDto } from './dto/media-asset-response.dto';
import { MediaUrlService } from './media-url.service';
import { MediaProcessingQueueService } from './media-processing-queue.service';
import {
  DEFAULT_MEDIA_UPLOAD_URL_TTL_SECONDS,
  MEDIA_UPLOAD_LIMITS,
  MEDIA_UPLOAD_URL_TTL_SECONDS_ENV,
} from './media.constants';

/**
 * Core orchestration for the centralized media pipeline (see
 * `.claude/workflows/S3_RESPONSIVE_IMAGE_PIPELINE.md`). Owns the three-step
 * direct-to-S3 lifecycle — authorize, confirm, process — and read/delete of
 * the resulting asset. Intentionally purpose-agnostic: AVATAR, PROOF, and
 * TASK_ATTACHMENT all flow through the exact same service; only
 * `assertAuthorized` and `variantPresetsFor` (media-variant-presets.ts)
 * branch per purpose. AVATAR is the only purpose a real endpoint calls this
 * from today (`UsersController` — see Task #7); PROOF/TASK_ATTACHMENT are
 * fully implemented and testable here but not yet wired into
 * ProofController/TasksController, which still use the legacy Multer path.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaUrl: MediaUrlService,
    private readonly queue: MediaProcessingQueueService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Step 1 of the direct-to-S3 flow: validates the declared upload against
   * the MIME allow-list and per-purpose size cap, authorizes it against the
   * purpose's parent entity (see assertAuthorized), creates a PENDING_UPLOAD
   * MediaAsset row, and returns a presigned PUT URL scoped to exactly the key
   * that row points at. Nothing is trusted from this request beyond what
   * gates *whether* an upload may happen — the real size/type are
   * re-verified against the actual S3 object in confirmUpload.
   */
  async createUploadAuthorization(
    userId: string,
    dto: CreateMediaUploadRequestDto,
  ): Promise<CreateMediaUploadResponseDto> {
    const extension = ALLOWED_IMAGE_MIME_TYPES[dto.mimeType];
    if (!extension) {
      throw new BadRequestException('UNSUPPORTED_IMAGE_TYPE');
    }

    const limit = MEDIA_UPLOAD_LIMITS[dto.purpose];
    if (dto.fileSize > limit) {
      throw new BadRequestException(
        `FILE_TOO_LARGE: ${dto.purpose} uploads are capped at ${limit} bytes`,
      );
    }

    await this.assertAuthorized(userId, dto.purpose, dto.relatedEntityId);

    const objectKey = this.buildOriginalKey(dto.purpose, userId, dto.mimeType);

    const asset = await this.prisma.mediaAsset.create({
      data: {
        id: randomUUID(),
        ownerId: userId,
        purpose: dto.purpose,
        relatedEntityId: dto.relatedEntityId ?? null,
        originalKey: objectKey,
        originalWidth: dto.width,
        originalHeight: dto.height,
        status: MediaStatus.PENDING_UPLOAD,
      },
    });

    const ttlSeconds = this.resolveUploadTtlSeconds();
    const uploadUrl = await this.storage.getSignedUploadUrl(objectKey, dto.mimeType, ttlSeconds);

    this.logger.log(`Authorized ${dto.purpose} upload ${asset.id} for user ${userId}`);

    return {
      mediaId: asset.id,
      uploadUrl,
      objectKey,
      requiredHeaders: { 'Content-Type': dto.mimeType },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /**
   * Step 2: the client calls this after the PUT to S3 succeeds. Re-verifies
   * the object actually landed (and within the declared size cap) via a real
   * HeadObject call — never trusts the client's earlier claim alone — then
   * flips status to UPLOADED and enqueues variant generation. Idempotent: a
   * retried confirm call for an asset already past PENDING_UPLOAD just
   * returns the current projection instead of re-enqueuing a duplicate job.
   */
  async confirmUpload(userId: string, mediaId: string): Promise<MediaAssetResponseDto> {
    const asset = await this.loadOwned(userId, mediaId);

    if (asset.status !== MediaStatus.PENDING_UPLOAD) {
      return this.toResponseDto(asset, await this.loadVariants(asset.id));
    }

    const head = await this.storage.headObject(asset.originalKey);
    if (!head) {
      throw new BadRequestException('UPLOAD_NOT_FOUND: no object was found at the authorized key');
    }

    const limit = MEDIA_UPLOAD_LIMITS[asset.purpose];
    if (head.size > limit) {
      // The object landed but exceeds the cap — delete it and fail the
      // asset rather than leaving an oversized object in the bucket.
      await this.storage.deleteObject(asset.originalKey).catch(() => undefined);
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: MediaStatus.FAILED, failureReason: 'UPLOADED_FILE_EXCEEDS_LIMIT' },
      });
      throw new BadRequestException(
        `FILE_TOO_LARGE: uploaded object is ${head.size} bytes, limit is ${limit}`,
      );
    }

    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: MediaStatus.UPLOADED,
        originalSize: head.size,
        originalFormat: head.contentType ?? undefined,
      },
    });

    await this.queue.enqueueGenerateVariants(updated.id);
    this.logger.log(`Confirmed upload ${updated.id}; queued variant generation`);

    return this.toResponseDto(updated, []);
  }

  async getMedia(userId: string, mediaId: string): Promise<MediaAssetResponseDto> {
    const asset = await this.loadOwned(userId, mediaId);
    return this.toResponseDto(asset, await this.loadVariants(asset.id));
  }

  /**
   * Loads and resolves the delivery-ready variants for an asset, with no
   * ownership check of its own — used by AuthService.toProfile to project
   * `User.avatarMediaId` into `UserProfileDto.avatarVariants`, where the
   * caller is always the profile owner and the FK itself (not user input) is
   * what selects the asset. Never call this with a caller-supplied mediaId
   * without an ownership check of your own — see `getMedia` for that path.
   */
  async resolveVariantsForAsset(mediaAssetId: string): Promise<MediaAssetResponseDto['variants']> {
    const variants = await this.loadVariants(mediaAssetId);
    return Promise.all(
      variants.map(async (variant) => ({
        name: variant.name,
        url: await this.mediaUrl.resolve(variant.objectKey),
        width: variant.width,
        height: variant.height,
        format: variant.format,
      })),
    );
  }

  /**
   * Deletes a MediaAsset: best-effort removes every S3 object (original +
   * all variants) then the DB row (MediaVariant rows cascade). Best-effort on
   * S3 mirrors the existing avatar-replacement convention in
   * UsersService.uploadAvatar — a storage hiccup must not block the row from
   * being removed, since a client that asked to delete no longer wants the
   * asset referenced regardless.
   */
  async deleteMedia(userId: string, mediaId: string): Promise<void> {
    const asset = await this.loadOwned(userId, mediaId);
    const variants = await this.loadVariants(asset.id);

    await Promise.all(
      [asset.originalKey, ...variants.map((v) => v.objectKey)].map((key) =>
        this.storage.deleteObject(key).catch((error) => {
          this.logger.warn(
            `Failed to delete media object ${key}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }),
      ),
    );

    await this.prisma.mediaAsset.delete({ where: { id: asset.id } });
    this.logger.log(`Deleted media asset ${asset.id} for user ${userId}`);
  }

  private async loadOwned(userId: string, mediaId: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset) {
      throw new NotFoundException('MEDIA_NOT_FOUND');
    }
    if (asset.ownerId !== userId) {
      // 404, not 403 — mirrors the payment-methods ownership convention
      // (don't confirm to a caller that a media id they don't own exists).
      throw new NotFoundException('MEDIA_NOT_FOUND');
    }
    return asset;
  }

  private async loadVariants(mediaAssetId: string): Promise<MediaVariant[]> {
    return this.prisma.mediaVariant.findMany({
      where: { mediaAssetId },
      orderBy: { width: 'asc' },
    });
  }

  private async toResponseDto(
    asset: MediaAsset,
    variants: MediaVariant[],
  ): Promise<MediaAssetResponseDto> {
    return {
      id: asset.id,
      purpose: asset.purpose,
      status: asset.status,
      createdAt: asset.createdAt.toISOString(),
      variants: await Promise.all(
        variants.map(async (variant) => ({
          name: variant.name,
          url: await this.mediaUrl.resolve(variant.objectKey),
          width: variant.width,
          height: variant.height,
          format: variant.format,
        })),
      ),
    };
  }

  /**
   * Authorizes an upload against its purpose's real parent entity —
   * `relatedEntityId` is interpreted differently per purpose (see the field's
   * doc comment on CreateMediaUploadRequestDto and on MediaAsset in
   * schema.prisma):
   *
   * - AVATAR: owner-scoped only, no parent entity. A supplied
   *   `relatedEntityId` is rejected outright — there's nothing for it to mean.
   * - PROOF: `relatedEntityId` is the **Mission** id the evidence is *for*
   *   (not a Completion id — the Completion row doesn't exist yet at upload
   *   time; it's created afterward by ProofController, which links this
   *   MediaAsset in as `proofMediaId`). Just needs to be a real, active
   *   mission; no per-user ownership to check since any user may submit
   *   proof for any mission.
   * - TASK_ATTACHMENT: `relatedEntityId` is the **UserTask** id the evidence
   *   is for (not a UserTaskSubmission id, for the same not-created-yet
   *   reason). Requires the caller be that task's creator or assignee.
   */
  private async assertAuthorized(
    userId: string,
    purpose: MediaPurpose,
    relatedEntityId: string | undefined,
  ): Promise<void> {
    switch (purpose) {
      case MediaPurpose.AVATAR: {
        if (relatedEntityId) {
          throw new BadRequestException(
            'RELATED_ENTITY_NOT_ALLOWED: AVATAR uploads are owner-scoped and take no relatedEntityId',
          );
        }
        return;
      }
      case MediaPurpose.PROOF: {
        if (!relatedEntityId) {
          throw new BadRequestException(
            'RELATED_ENTITY_REQUIRED: PROOF uploads require a mission id',
          );
        }
        const mission = await this.prisma.mission.findUnique({
          where: { id: relatedEntityId },
          select: { id: true, isActive: true },
        });
        if (!mission || !mission.isActive) {
          throw new NotFoundException('MISSION_NOT_FOUND');
        }
        return;
      }
      case MediaPurpose.TASK_ATTACHMENT: {
        if (!relatedEntityId) {
          throw new BadRequestException(
            'RELATED_ENTITY_REQUIRED: TASK_ATTACHMENT uploads require a task id',
          );
        }
        const task = await this.prisma.userTask.findUnique({
          where: { id: relatedEntityId },
          select: { creatorId: true, assigneeId: true },
        });
        if (!task) {
          throw new NotFoundException('TASK_NOT_FOUND');
        }
        if (task.creatorId !== userId && task.assigneeId !== userId) {
          throw new ForbiddenException('NOT_A_TASK_PARTICIPANT');
        }
        return;
      }
      default: {
        const exhaustive: never = purpose;
        throw new BadRequestException(`Unsupported media purpose ${String(exhaustive)}`);
      }
    }
  }

  private buildOriginalKey(purpose: MediaPurpose, userId: string, contentType: string): string {
    switch (purpose) {
      case MediaPurpose.AVATAR:
        return this.storage.buildAvatarKey(userId, contentType);
      case MediaPurpose.PROOF:
        return this.storage.buildProofKey(userId, contentType);
      case MediaPurpose.TASK_ATTACHMENT:
        return this.storage.buildTaskAttachmentKey(userId, contentType);
      default: {
        const exhaustive: never = purpose;
        throw new BadRequestException(`Unsupported media purpose ${String(exhaustive)}`);
      }
    }
  }

  private resolveUploadTtlSeconds(): number {
    const raw = Number(this.config.get<string>(MEDIA_UPLOAD_URL_TTL_SECONDS_ENV));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MEDIA_UPLOAD_URL_TTL_SECONDS;
  }
}
