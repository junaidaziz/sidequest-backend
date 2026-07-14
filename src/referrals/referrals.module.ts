import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/**
 * Invite Friends / Referrals (M20). PrismaService is global via PrismaModule;
 * IdempotencyModule provides the shared request-dedupe service (Decision 9) for
 * POST /referrals/invites. Exports ReferralsService so AuthModule (signup
 * attribution), ProofModule and TasksModule (the completion hook) can consume
 * it one-directionally — this module depends on neither of them, so there is no
 * dependency cycle.
 */
@Module({
  imports: [IdempotencyModule, NotificationsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
