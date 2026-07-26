import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  GENERATE_VARIANTS_JOB,
  GenerateVariantsJobData,
  MEDIA_PROCESSING_MAX_ATTEMPTS,
  MEDIA_PROCESSING_QUEUE,
} from './media.constants';

/**
 * Thin producer wrapper around the media-processing queue, mirroring
 * VerificationQueueService's shape. The job id is the MediaAsset id itself
 * (not a composite string) — a MediaAsset only ever needs one
 * variant-generation job in flight at a time, so BullMQ's own dedupe-by-id
 * behavior is exactly the idempotency guard a duplicate confirmUpload call
 * (e.g. a retried request) needs, with no extra bookkeeping.
 */
@Injectable()
export class MediaProcessingQueueService {
  private readonly logger = new Logger(MediaProcessingQueueService.name);

  constructor(
    @InjectQueue(MEDIA_PROCESSING_QUEUE) private readonly queue: Queue<GenerateVariantsJobData>,
  ) {}

  async enqueueGenerateVariants(mediaAssetId: string): Promise<void> {
    await this.queue.add(
      GENERATE_VARIANTS_JOB,
      { mediaAssetId },
      {
        jobId: mediaAssetId,
        attempts: MEDIA_PROCESSING_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: { count: 1_000 },
      },
    );
    this.logger.log(`Queued variant generation for media asset ${mediaAssetId}`);
  }
}
