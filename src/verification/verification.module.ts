import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VerificationProcessor } from './verification.processor';
import { VerificationQueueService } from './verification-queue.service';
import { VERIFICATION_QUEUE } from './verification.constants';

/**
 * Owns the `verification` BullMQ queue: the producer (VerificationQueueService,
 * exported for ProofModule to enqueue on submit) and the consumer
 * (VerificationProcessor, the delayed auto-approver). PrismaService is global
 * via PrismaModule; the BullMQ root connection is configured in AppModule.
 */
@Module({
  imports: [BullModule.registerQueue({ name: VERIFICATION_QUEUE })],
  providers: [VerificationQueueService, VerificationProcessor],
  exports: [VerificationQueueService],
})
export class VerificationModule {}
