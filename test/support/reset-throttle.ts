import { INestApplication } from '@nestjs/common';
import { RedisService } from './../../src/redis/redis.service';

/**
 * Clears `@nestjs/throttler` rate-limit state from the shared Redis instance.
 *
 * The Redis-backed throttler storage (unlike the previous in-memory store,
 * which was isolated per Nest app instance) persists throttle counters in
 * Redis across e2e suites and across runs until each key's TTL expires. With
 * `maxWorkers: 1` every suite shares the same Redis, so the combined
 * guest/signup/login/generate calls quickly trip the per-tier limits with
 * spurious 429s. Each e2e suite therefore resets this state in `beforeAll`.
 *
 * The storage writes keys wrapped in a `{...}` hash tag and suffixed with
 * `:hits` / `:blocked`; those suffixes are unique to the throttler, so this
 * never touches the mission-pool cache keys sharing the same Redis.
 */
export async function resetThrottleState(app: INestApplication): Promise<void> {
  const redis = app.get(RedisService);
  for (const pattern of ['{*}:hits', '{*}:blocked']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}
