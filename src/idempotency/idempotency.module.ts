import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Provides the shared IdempotencyService (Decision 9). PrismaService is global
 * via PrismaModule, so this module only wires and exports the service for any
 * feature module (currently TasksModule) that needs request deduplication.
 */
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
