import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  CMS_CACHE_KEY_PREFIX,
  CMS_PUBLIC_CACHE_DEFAULT_TTL_SECONDS,
  CmsCacheTag,
} from '../cms.constants';

/**
 * Redis-backed cache for the unauthenticated public CMS reads, mirroring
 * MissionPoolService's convention exactly: strictly best-effort — any Redis
 * error falls straight through to Postgres and never fails a request. Public
 * marketing pages will hit these endpoints on every render once wired, so a
 * short TTL (default 300s, matching the web app's ISR fallback) plus explicit
 * invalidation on every admin mutation keeps them cheap without going stale.
 *
 * Only the raw DB rows are cached — never presigned asset URLs, which are
 * short-lived and re-signed per response after the cache read.
 */
@Injectable()
export class CmsCacheService {
  private readonly logger = new Logger(CmsCacheService.name);
  private readonly ttlSeconds: number;

  constructor(private readonly redis: RedisService) {
    const raw = process.env.CMS_PUBLIC_CACHE_TTL_SECONDS;
    const parsed = raw === undefined ? CMS_PUBLIC_CACHE_DEFAULT_TTL_SECONDS : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`CMS_PUBLIC_CACHE_TTL_SECONDS must be a positive number, got "${raw}"`);
    }
    this.ttlSeconds = parsed;
  }

  private key(tag: CmsCacheTag, discriminator?: string): string {
    return `${CMS_CACHE_KEY_PREFIX}${tag}${discriminator ? `:${discriminator}` : ''}`;
  }

  /** Reads a cached value, returning null on a miss OR any Redis failure. */
  async get<T>(tag: CmsCacheTag, discriminator?: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.key(tag, discriminator));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`Cache read failed (${tag}), falling back to Postgres: ${asMessage(error)}`);
      return null;
    }
  }

  /** Writes a value with the configured TTL. Best-effort — swallows failures. */
  async set<T>(tag: CmsCacheTag, value: T, discriminator?: string): Promise<void> {
    try {
      await this.redis.set(
        this.key(tag, discriminator),
        JSON.stringify(value),
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(`Cache write failed (${tag}): ${asMessage(error)}`);
    }
  }

  /**
   * Drops every cached entry for a content type (the un-discriminated list key
   * plus any per-slug keys) after a mutation. Uses SCAN, not KEYS, so it never
   * blocks Redis on a large keyspace.
   */
  async invalidate(tag: CmsCacheTag): Promise<void> {
    const pattern = `${CMS_CACHE_KEY_PREFIX}${tag}*`;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Cache invalidation failed (${tag}): ${asMessage(error)}`);
    }
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
