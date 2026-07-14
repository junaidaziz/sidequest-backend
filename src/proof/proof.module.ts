import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VerificationModule } from '../verification/verification.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';

/**
 * Mission proof submission. PrismaService is available globally via PrismaModule;
 * StorageModule provides the S3-backed StorageService for photo proofs;
 * VerificationModule exports the queue producer used to schedule auto-approval;
 * ReferralsModule provides the completion hook (M20) — a curated-mission
 * completion is one of the two events that can qualify a referral's reward.
 */
@Module({
  imports: [StorageModule, VerificationModule, ReferralsModule],
  controllers: [ProofController],
  providers: [ProofService],
})
export class ProofModule {}
