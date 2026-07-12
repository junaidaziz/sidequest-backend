import { Injectable, Logger } from '@nestjs/common';
import { Mission } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const CACHE_KEY = 'missions:active-pool';
const DEFAULT_CACHE_TTL_SECONDS = 60;

/** Cache payload shape: Mission with its Date fields as ISO strings, since
 * that's what survives a JSON.stringify/parse round-trip through Redis. */
type CachedMission = Omit<Mission, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

function reviveMission(cached: CachedMission): Mission {
  return {
    ...cached,
    createdAt: new Date(cached.createdAt),
    updatedAt: new Date(cached.updatedAt),
    deletedAt: cached.deletedAt ? new Date(cached.deletedAt) : null,
  };
}

@Injectable()
export class MissionPoolService {
  private readonly logger = new Logger(MissionPoolService.name);
  /**
   * Read in the constructor (DI-instantiation time), not at module top-level
   * — top-level `process.env` reads run at `import` time, before
   * ConfigModule.forRoot() has loaded .env, and would silently ignore an
   * env-file-only value. Validated eagerly so a bad value fails loudly at
   * boot instead of silently disabling cache writes on every request.
   */
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    const raw = process.env.MISSION_POOL_CACHE_TTL_SECONDS;
    const parsed = raw === undefined ? DEFAULT_CACHE_TTL_SECONDS : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`MISSION_POOL_CACHE_TTL_SECONDS must be a positive number, got "${raw}"`);
    }
    this.cacheTtlSeconds = parsed;
  }

  /**
   * The active, non-deleted mission pool ordered by id — the single query
   * both mission generation (random-sampled) and Home's deterministic daily
   * pick (indexes into this stable order) depend on. Cached in Redis with a
   * short TTL since the pool only ever changes via manual seeding today; the
   * cache is strictly best-effort — any Redis error falls straight through
   * to Postgres rather than failing the request.
   */
  async getActivePool(): Promise<Mission[]> {
    const cached = await this.readCache();
    if (cached) return cached;

    const missions = await this.prisma.mission.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { id: 'asc' },
    });

    void this.writeCache(missions);
    return missions;
  }

  private async readCache(): Promise<Mission[] | null> {
    try {
      const raw = await this.redis.get(CACHE_KEY);
      if (!raw) return null;
      return (JSON.parse(raw) as CachedMission[]).map(reviveMission);
    } catch (error) {
      this.logger.warn(`Cache read failed, falling back to Postgres: ${(error as Error).message}`);
      return null;
    }
  }

  private async writeCache(missions: Mission[]): Promise<void> {
    try {
      await this.redis.set(CACHE_KEY, JSON.stringify(missions), 'EX', this.cacheTtlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed: ${(error as Error).message}`);
    }
  }
}
