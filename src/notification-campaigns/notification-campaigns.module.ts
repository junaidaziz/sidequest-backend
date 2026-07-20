import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NOTIFICATION_CAMPAIGNS_QUEUE } from './notification-campaigns.constants';
import { NotificationCampaignsController } from './notification-campaigns.controller';
import { NotificationCampaignsProcessor } from './notification-campaigns.processor';
import { NotificationCampaignsQueueService } from './notification-campaigns-queue.service';
import { NotificationCampaignsService } from './notification-campaigns.service';

/**
 * Admin notification campaigns (Phase 11). Owns the app's THIRD BullMQ queue,
 * `campaigns` (alongside `verification` and `notifications`): the producer
 * (NotificationCampaignsQueueService) and the consumer
 * (NotificationCampaignsProcessor, the fan-out worker) are both registered here,
 * keeping the module self-contained rather than bolting a job onto the
 * notifications queue.
 *
 * Gated by the new RBAC system, NOT the legacy `AdminGuard`. PrismaService is
 * global; `PermissionGuard`/resolver come from the @Global RbacModule and the
 * 'admin-jwt' strategy is registered process-wide by AdminAuthModule — so none of
 * those are imported here (mirrors AdminChallengesModule/ModerationModule wiring).
 * AuditLogModule supplies the audit trail; NotificationsModule is imported for its
 * exported `NotificationsService`, which the processor calls per recipient (the
 * per-recipient notification-creation + push-delivery primitive is REUSED, not
 * reimplemented). The BullMQ root connection is configured in AppModule.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_CAMPAIGNS_QUEUE }),
    AuditLogModule,
    NotificationsModule,
  ],
  controllers: [NotificationCampaignsController],
  providers: [
    NotificationCampaignsService,
    NotificationCampaignsQueueService,
    NotificationCampaignsProcessor,
  ],
})
export class NotificationCampaignsModule {}
