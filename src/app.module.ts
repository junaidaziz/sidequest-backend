import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MissionsModule } from './missions/missions.module';
import { StorageModule } from './storage/storage.module';
import { ProofModule } from './proof/proof.module';
import { HomeModule } from './home/home.module';
import { VerificationModule } from './verification/verification.module';
import { AdminModule } from './admin/admin.module';
import { PaymentModule } from './payment/payment.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { TasksModule } from './tasks/tasks.module';
import { ReferralsModule } from './referrals/referrals.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailModule } from './email/email.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { RbacModule } from './rbac/rbac.module';
import { CmsModule } from './cms/cms.module';
import { AppConfigModule } from './app-config/app-config.module';
import { AdminChallengesModule } from './admin-challenges/admin-challenges.module';
import { AdminMissionTagsModule } from './admin-mission-tags/admin-mission-tags.module';
import { ModerationModule } from './moderation/moderation.module';
import { NotificationCampaignsModule } from './notification-campaigns/notification-campaigns.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ContactModule } from './contact/contact.module';
import { MediaModule } from './media/media.module';
import { TrustedIpThrottlerGuard } from './common/guards/trusted-ip-throttler.guard';

/**
 * `Number(...)` of a non-numeric env value silently produces NaN, which would
 * misconfigure rate limiting for every endpoint with no error at boot. Fall
 * back to the default instead of propagating NaN.
 */
function parseThrottleEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * BullMQ needs host/port/auth connection options, not the ioredis instance the
 * throttler reuses. Parse them out of the single REDIS_URL (same source of
 * truth) so there is no second Redis config surface. Falls back to the local
 * default when unset, matching RedisService.
 */
function bullConnectionFromRedisUrl(redisUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
} {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    // Rate-limit state is backed by Redis (reusing the single RedisModule
    // connection — no second Redis config surface) so every @Throttle tier is a
    // true global cap across processes, not a per-instance counter that would
    // silently multiply the moment this runs on more than one instance.
    ThrottlerModule.forRootAsync({
      inject: [RedisService, ConfigService],
      useFactory: (redis: RedisService, config: ConfigService) => ({
        throttlers: [
          {
            ttl: parseThrottleEnv(config.get<string>('THROTTLE_TTL'), 60000),
            limit: parseThrottleEnv(config.get<string>('THROTTLE_LIMIT'), 100),
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    // BullMQ root connection for every queue (the verification auto-approve
    // queue and the notifications push-delivery queue). Connection built from
    // REDIS_URL, same store the throttler and cache use.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: bullConnectionFromRedisUrl(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    AuthModule,
    UsersModule,
    MissionsModule,
    StorageModule,
    MediaModule,
    ProofModule,
    HomeModule,
    VerificationModule,
    AdminModule,
    PaymentModule,
    IdempotencyModule,
    TasksModule,
    ReferralsModule,
    NotificationsModule,
    // Phase 4 — admin platform infrastructure.
    EmailModule,
    AuditLogModule,
    AdminAuthModule,
    RbacModule,
    // Phase 7 — CMS + application config (public cached reads + admin CRUD).
    CmsModule,
    AppConfigModule,
    // Phase 9 — admin challenge (Mission) authoring: CRUD + publish/archive/etc.
    AdminChallengesModule,
    // Closed-beta admin tooling — admin-managed mission crew/setting tag vocabulary.
    AdminMissionTagsModule,
    // Closed-beta admin tooling — public contact form intake + admin triage.
    ContactModule,
    // Phase 10 — moderation queue + Report/ModerationAction/Appeal workflow, and
    // the RBAC-gated proof-review route. The legacy AdminGuard/x-admin-key
    // completion-verification route was removed in this phase's cutover.
    ModerationModule,
    // Phase 11 — admin notification campaigns: CRUD + audience preview +
    // send/schedule/cancel, fanned out via the app's third BullMQ queue
    // (`campaigns`), reusing NotificationsService.notify() per recipient.
    NotificationCampaignsModule,
    // Phase 12 — admin analytics dashboard: read-only KPI aggregates (users,
    // completions, backlog, moderation, level/activation, device tokens, campaign
    // rollup, live BullMQ queue depth, recent admin activity) + CSV export, behind
    // a short best-effort Redis cache. No new queue/schema/permission is added.
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      // TrustedIpThrottlerGuard is a drop-in ThrottlerGuard subclass: it behaves
      // identically to the stock guard except it honours a secret-gated forwarded
      // client IP from the trusted `web` BFF (see the guard's own doc comment).
      provide: APP_GUARD,
      useClass: TrustedIpThrottlerGuard,
    },
  ],
})
export class AppModule {}
