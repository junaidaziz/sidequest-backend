import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** After this many consecutive failures, the account is locked. Closes W4. */
export const MAX_FAILED_ATTEMPTS = 5;
/** Durable lockout duration once the threshold is hit. */
export const LOCKOUT_MINUTES = 15;
/** Redis fail-counter TTL — a rolling window that resets between bursts. */
const COUNTER_TTL_SECONDS = LOCKOUT_MINUTES * 60;

/**
 * Two-layer account lockout (closes security finding W4):
 *  1. A fast Redis fail-counter per admin id (TTL-based, resets on success).
 *  2. A durable Postgres `lockedUntil` + `failedLoginCount` once the threshold is
 *     hit, so a lockout survives a Redis flush/restart.
 *
 * This is in addition to (not a replacement for) the per-IP @Throttle on the
 * login route — both layers, as the plan requires.
 */
@Injectable()
export class AdminLockoutService {
  private readonly logger = new Logger(AdminLockoutService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  private key(adminUserId: string): string {
    return `admin:login:fail:${adminUserId}`;
  }

  /** True when the admin is currently locked (durable Postgres check). */
  isLocked(lockedUntil: Date | null): boolean {
    return lockedUntil !== null && lockedUntil.getTime() > Date.now();
  }

  /**
   * Records a failed attempt. Increments the Redis counter; once it reaches the
   * threshold, sets a durable `lockedUntil` in Postgres. Redis errors are
   * swallowed (best-effort cache) — the durable layer is the source of truth.
   */
  async recordFailure(adminUserId: string): Promise<void> {
    let count = 0;
    try {
      count = await this.redis.incr(this.key(adminUserId));
      if (count === 1) {
        await this.redis.expire(this.key(adminUserId), COUNTER_TTL_SECONDS);
      }
    } catch (error) {
      this.logger.warn(
        `Redis fail-counter unavailable for ${adminUserId}; relying on durable counter`,
      );
    }

    // Mirror the durable counter and lock when the threshold is reached. Read the
    // current durable count so a Redis flush can't reset progress below it.
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { failedLoginCount: true },
    });
    const durableCount = Math.max(count, (admin?.failedLoginCount ?? 0) + 1);
    const shouldLock = durableCount >= MAX_FAILED_ATTEMPTS;

    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: {
        failedLoginCount: durableCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : undefined,
      },
    });

    if (shouldLock) {
      this.logger.warn(`Admin ${adminUserId} locked after ${durableCount} failed attempts`);
    }
  }

  /** Clears both counters on a successful login. */
  async recordSuccess(adminUserId: string): Promise<void> {
    try {
      await this.redis.del(this.key(adminUserId));
    } catch {
      // best-effort
    }
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }
}
