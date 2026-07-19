import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AppConfig, Prisma } from '@prisma/client';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { CmsRevalidationService } from '../cms/services/cms-revalidation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  APP_CONFIG_KEY_PATTERN,
  isPublicConfigKey,
  PUBLIC_APP_CONFIG_KEYS,
} from './app-config.constants';
import { AppConfigDto } from './dto/app-config.dto';
import { UpsertAppConfigDto } from './dto/app-config.dto';
import { CmsRequestContext } from '../cms/types/cms.types';

const PUBLIC_CACHE_KEY = 'config:public';
const PUBLIC_REVALIDATE_TAG = 'config:public';
const DEFAULT_TTL_SECONDS = 300;

/**
 * Singleton-style key/value application configuration. Admin CRUD is gated by
 * `app_config.view` / `app_config.manage`; a separate unauthenticated
 * `GET /config/public` returns only the code-reviewed allow-list of public keys
 * (see app-config.constants). Every mutation is audited, and a change to a
 * public key invalidates the public cache and best-effort revalidates the site.
 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly redis: RedisService,
    private readonly revalidation: CmsRevalidationService,
  ) {
    const raw = process.env.CMS_PUBLIC_CACHE_TTL_SECONDS;
    const parsed = raw === undefined ? DEFAULT_TTL_SECONDS : Number(raw);
    this.ttlSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
  }

  /** All non-deleted config entries (admin view). */
  async list(): Promise<AppConfigDto[]> {
    const rows = await this.prisma.appConfig.findMany({
      where: { deletedAt: null },
      orderBy: { key: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(key: string): Promise<AppConfigDto> {
    const row = await this.prisma.appConfig.findFirst({ where: { key, deletedAt: null } });
    if (!row) {
      throw new NotFoundException('Config key not found');
    }
    return this.toDto(row);
  }

  /** Creates or updates a config key. */
  async upsert(
    actor: AuthAdmin,
    key: string,
    dto: UpsertAppConfigDto,
    ctx: CmsRequestContext,
  ): Promise<AppConfigDto> {
    if (!APP_CONFIG_KEY_PATTERN.test(key)) {
      throw new BadRequestException('Invalid config key format');
    }
    const existing = await this.prisma.appConfig.findUnique({ where: { key } });
    const row = await this.prisma.appConfig.upsert({
      where: { key },
      create: {
        key,
        value: dto.value,
        description: dto.description ?? null,
        createdByAdminId: actor.adminUserId,
        updatedByAdminId: actor.adminUserId,
      },
      update: {
        value: dto.value,
        description: dto.description ?? undefined,
        deletedAt: null,
        updatedByAdminId: actor.adminUserId,
      },
    });

    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'app_config.manage',
      targetType: 'AppConfig',
      targetId: row.id,
      previousValue: existing ? { key, value: existing.value as Prisma.InputJsonValue } : null,
      newValue: { key, value: dto.value, __verb: existing ? 'update' : 'create' },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.afterMutation(key);
    return this.toDto(row);
  }

  /** Soft-deletes a config key. */
  async remove(actor: AuthAdmin, key: string, ctx: CmsRequestContext): Promise<void> {
    const existing = await this.prisma.appConfig.findFirst({ where: { key, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Config key not found');
    }
    await this.prisma.appConfig.update({
      where: { key },
      data: { deletedAt: new Date(), updatedByAdminId: actor.adminUserId },
    });
    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'app_config.manage',
      targetType: 'AppConfig',
      targetId: existing.id,
      previousValue: { key, value: existing.value as Prisma.InputJsonValue },
      newValue: { key, __verb: 'delete' },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    await this.afterMutation(key);
  }

  /**
   * Public config surface — only the allow-listed keys, as a flat map. Cached in
   * Redis (best-effort) since it will be read on public page loads.
   */
  async getPublic(): Promise<Record<string, Prisma.JsonValue>> {
    const cached = await this.readCache();
    if (cached) {
      return cached;
    }
    const rows = await this.prisma.appConfig.findMany({
      where: { key: { in: [...PUBLIC_APP_CONFIG_KEYS] }, deletedAt: null },
    });
    const map: Record<string, Prisma.JsonValue> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    await this.writeCache(map);
    return map;
  }

  private toDto(row: AppConfig): AppConfigDto {
    return {
      id: row.id,
      key: row.key,
      value: row.value,
      description: row.description,
      isPublic: isPublicConfigKey(row.key),
      updatedAt: row.updatedAt,
    };
  }

  /** Only a change to a PUBLIC key needs to bust the public cache / revalidate. */
  private async afterMutation(key: string): Promise<void> {
    if (!isPublicConfigKey(key)) {
      return;
    }
    await this.invalidateCache();
    this.revalidation.trigger([PUBLIC_REVALIDATE_TAG]);
  }

  private async readCache(): Promise<Record<string, Prisma.JsonValue> | null> {
    try {
      const raw = await this.redis.get(PUBLIC_CACHE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, Prisma.JsonValue>) : null;
    } catch (error) {
      this.logger.warn(`Public config cache read failed: ${asMessage(error)}`);
      return null;
    }
  }

  private async writeCache(map: Record<string, Prisma.JsonValue>): Promise<void> {
    try {
      await this.redis.set(PUBLIC_CACHE_KEY, JSON.stringify(map), 'EX', this.ttlSeconds);
    } catch (error) {
      this.logger.warn(`Public config cache write failed: ${asMessage(error)}`);
    }
  }

  private async invalidateCache(): Promise<void> {
    try {
      await this.redis.del(PUBLIC_CACHE_KEY);
    } catch (error) {
      this.logger.warn(`Public config cache invalidation failed: ${asMessage(error)}`);
    }
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
