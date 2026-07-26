import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MediaStatus } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildVariantKey } from './media-key.util';
import { isSquarePurpose, variantPresetsFor } from './media-variant-presets';
import { GenerateVariantsJobData, MEDIA_PROCESSING_QUEUE } from './media.constants';

/** Every generated variant is re-encoded to WebP — smaller than JPEG/PNG at equivalent visual quality, and universally supported by the mobile app's Image components. */
const VARIANT_FORMAT = 'webp';
const VARIANT_QUALITY = 82;

/**
 * Consumes `generate-variants` jobs: downloads a MediaAsset's original from
 * S3, validates it's a real, decodable image, generates every preset variant
 * for its purpose, uploads each to its own object key, and upserts the
 * resulting MediaVariant rows before flipping status to READY. A processing
 * failure (corrupt image, S3 error, etc.) flips status to FAILED with a
 * diagnostic reason rather than leaving the asset stuck in UPLOADED forever —
 * BullMQ's own retry/backoff (see MediaProcessingQueueService) gives a
 * transient failure a few chances before that terminal state is reached.
 *
 * Idempotent by construction: MediaVariant is upserted on the
 * `(mediaAssetId, name)` unique constraint, so a retried/duplicate job (the
 * same BullMQ job id retried after a crash mid-run, or a rare duplicate
 * delivery) safely overwrites rather than duplicating rows.
 */
@Processor(MEDIA_PROCESSING_QUEUE)
export class MediaProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<GenerateVariantsJobData>): Promise<void> {
    const { mediaAssetId } = job.data;

    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    if (!asset) {
      this.logger.warn(`Variant generation skipped: media asset ${mediaAssetId} no longer exists`);
      return;
    }
    if (asset.status === MediaStatus.READY) {
      // Already processed by a prior attempt of this same job.
      return;
    }

    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: MediaStatus.PROCESSING },
    });

    try {
      const original = await this.storage.downloadObject(asset.originalKey);
      // .rotate() with no args auto-orients from EXIF *before* any metadata
      // is stripped, so the physical pixels end up correctly oriented even
      // though the output (no .withMetadata() call) carries no EXIF at all —
      // this is how orientation survives while the actual EXIF payload
      // (which can carry GPS coordinates) does not.
      const source = sharp(original).rotate();
      const metadata = await source.metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error('INVALID_IMAGE: could not read image dimensions');
      }

      const presets = variantPresetsFor(asset.purpose);
      const square = isSquarePurpose(asset.purpose);

      const variants = await Promise.all(
        Object.entries(presets).map(async ([name, dims]) => {
          const pipeline = square
            ? source.clone().resize(dims.width, dims.height ?? dims.width, { fit: 'cover' })
            : source
                .clone()
                .resize(dims.width, undefined, { fit: 'inside', withoutEnlargement: true });

          const buffer = await pipeline.webp({ quality: VARIANT_QUALITY }).toBuffer();
          const outputMeta = await sharp(buffer).metadata();
          const key = buildVariantKey(asset.originalKey, name, VARIANT_FORMAT);
          await this.storage.uploadObject(key, buffer, 'image/webp');

          return {
            name,
            objectKey: key,
            width: outputMeta.width ?? dims.width,
            height: outputMeta.height ?? dims.height ?? dims.width,
            format: VARIANT_FORMAT,
            byteSize: buffer.length,
          };
        }),
      );

      await this.prisma.$transaction([
        ...variants.map((variant) =>
          this.prisma.mediaVariant.upsert({
            where: { mediaAssetId_name: { mediaAssetId: asset.id, name: variant.name } },
            create: { mediaAssetId: asset.id, ...variant },
            update: variant,
          }),
        ),
        this.prisma.mediaAsset.update({
          where: { id: asset.id },
          data: {
            status: MediaStatus.READY,
            failureReason: null,
            originalWidth: metadata.width,
            originalHeight: metadata.height,
            originalFormat: metadata.format,
          },
        }),
      ]);

      this.logger.log(`Generated ${variants.length} variants for media asset ${asset.id}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'UNKNOWN_PROCESSING_ERROR';
      this.logger.error(`Variant generation failed for media asset ${asset.id}: ${reason}`);
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: MediaStatus.FAILED, failureReason: reason.slice(0, 500) },
      });
      throw error;
    }
  }
}
