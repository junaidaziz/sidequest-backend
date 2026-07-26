import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '../storage/storage.module';
import { MediaController } from './media.controller';
import { MediaProcessingProcessor } from './media-processing.processor';
import { MediaProcessingQueueService } from './media-processing-queue.service';
import { MediaService } from './media.service';
import { MediaUrlService } from './media-url.service';
import { MEDIA_PROCESSING_QUEUE } from './media.constants';

/**
 * Owns the `media-processing` BullMQ queue and the reusable direct-to-S3
 * media pipeline. Exports MediaService and MediaUrlService so other feature
 * modules (UsersModule today; ProofModule/TasksModule once Task #7's scope
 * extends to them) can adopt the pipeline without duplicating it — mirrors
 * VerificationModule exporting its queue service for ProofModule to consume.
 */
@Module({
  imports: [StorageModule, BullModule.registerQueue({ name: MEDIA_PROCESSING_QUEUE })],
  controllers: [MediaController],
  providers: [MediaService, MediaUrlService, MediaProcessingQueueService, MediaProcessingProcessor],
  exports: [MediaService, MediaUrlService],
})
export class MediaModule {}
