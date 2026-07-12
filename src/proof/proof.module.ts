import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';

/**
 * Mission proof submission. PrismaService is available globally via PrismaModule;
 * StorageModule provides the S3-backed StorageService for photo proofs.
 */
@Module({
  imports: [StorageModule],
  controllers: [ProofController],
  providers: [ProofService],
})
export class ProofModule {}
