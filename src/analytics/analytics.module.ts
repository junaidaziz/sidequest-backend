import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NOTIFICATION_CAMPAIGNS_QUEUE } from '../notification-campaigns/notification-campaigns.constants';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants';
import { VERIFICATION_QUEUE } from '../verification/verification.constants';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Admin analytics dashboard (Phase 12): read-only aggregate KPIs + CSV export.
 *
 * Gated by the RBAC system, NOT the legacy `AdminGuard`. PrismaService and
 * RedisService are global; `PermissionGuard`/resolver come from the @Global
 * RbacModule and the 'admin-jwt' strategy is registered process-wide by
 * AdminAuthModule — so none of those are imported here (mirrors ModerationModule /
 * NotificationCampaignsModule wiring).
 *
 * `BullModule.registerQueue` is declared for the three EXISTING queue names so the
 * service can inject each `Queue` purely to read live `getJobCounts()` — no new
 * queue, producer, or consumer is added; the root BullMQ connection is configured in
 * AppModule and these registrations just hand back queue handles bound to it.
 * AuditLogModule supplies AuditLogService, whose `list()` is REUSED for the recent
 * admin-activity feed rather than building a parallel activity log.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: VERIFICATION_QUEUE },
      { name: NOTIFICATIONS_QUEUE },
      { name: NOTIFICATION_CAMPAIGNS_QUEUE },
    ),
    AuditLogModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
