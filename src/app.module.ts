import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { AuthModule } from './auth/auth.module';
import { MissionsModule } from './missions/missions.module';
import { StorageModule } from './storage/storage.module';
import { ProofModule } from './proof/proof.module';
import { HomeModule } from './home/home.module';

/**
 * `Number(...)` of a non-numeric env value silently produces NaN, which would
 * misconfigure rate limiting for every endpoint with no error at boot. Fall
 * back to the default instead of propagating NaN.
 */
function parseThrottleEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    AuthModule,
    MissionsModule,
    StorageModule,
    ProofModule,
    HomeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
