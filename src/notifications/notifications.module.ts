import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsProcessor } from './notifications.processor';
import { ExpoPushClient } from './expo-push.client';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';
import { PUSH_PROVIDER_CLIENT } from './push-provider.interface';

/**
 * Notifications (M21). Owns the `notifications` BullMQ queue: the producer
 * (NotificationsQueueService), the consumer (NotificationsProcessor, the push
 * delivery + receipt-poll worker), and the provider adapter (ExpoPushClient,
 * bound to the PUSH_PROVIDER_CLIENT token so the processor is testable without
 * the Expo SDK). PrismaService is global via PrismaModule; the BullMQ root
 * connection is configured in AppModule.
 *
 * Exports NotificationsService so TasksModule (M19), ReferralsModule (M20) and
 * AuthModule (logout deregistration + account events) can consume it
 * one-directionally — this module imports none of them, so there is no cycle.
 */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsQueueService,
    NotificationsProcessor,
    { provide: PUSH_PROVIDER_CLIENT, useClass: ExpoPushClient },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
