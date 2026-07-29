import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationModule } from '../moderation/moderation.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/**
 * Peer-to-peer user-created tasks (M19). PrismaService is global via
 * PrismaModule; StorageModule provides S3-backed evidence-attachment handling;
 * IdempotencyModule provides the shared request-dedupe service (Decision 9);
 * ReferralsModule provides the completion hook (M20) — an approved task
 * completion is one of the two events that can qualify a referral's reward.
 * ModerationModule provides ReportsService, whose reporter-local/global hide
 * filters exclude reported submissions from the participant-facing read paths
 * (GET /tasks/:id, GET /tasks/:id/submissions). No import cycle: nothing in
 * ModerationModule's dependency graph imports TasksModule, so a plain import
 * (not forwardRef) is safe here.
 */
@Module({
  imports: [
    StorageModule,
    IdempotencyModule,
    ReferralsModule,
    NotificationsModule,
    ModerationModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
