import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** Global role-version counter — bumped on any role/permission/override change. */
const ROLE_VERSION_KEY = 'rbac:role-version';
/** Cached effective-permission set TTL (a safety net; the version bump is the real invalidation). */
const CACHE_TTL_SECONDS = 300;

/**
 * Resolves an admin's EFFECTIVE permission set —
 *   (role's permissions ∪ GRANT overrides) − REVOKE overrides
 * — and caches it in Redis keyed by adminUserId + a global role-version counter.
 *
 * The role-version is a single global integer bumped on ANY role/permission/
 * override change (simplest correct choice — a per-role counter would be finer
 * but this is a small table and a global bump can never serve a stale set). A
 * bump changes every cache key, so a permission edit is effective immediately;
 * old keys simply expire. Cache is best-effort — any Redis error falls back to
 * a fresh DB computation, never a wrong answer.
 */
@Injectable()
export class PermissionResolverService {
  private readonly logger = new Logger(PermissionResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Increments the global role-version, invalidating every cached permission set. */
  async bumpRoleVersion(): Promise<void> {
    try {
      await this.redis.incr(ROLE_VERSION_KEY);
    } catch {
      // Best-effort: if Redis is down there is nothing cached to invalidate anyway.
      this.logger.warn('Could not bump role-version (Redis unavailable)');
    }
  }

  /** True when the admin holds every one of `required` (ALL semantics). */
  async hasAll(adminUserId: string, required: string[]): Promise<boolean> {
    if (required.length === 0) {
      return true;
    }
    const effective = await this.getEffectivePermissions(adminUserId);
    return required.every((key) => effective.has(key));
  }

  /** Returns the admin's effective permission keys, cached by adminUserId + role-version. */
  async getEffectivePermissions(adminUserId: string): Promise<Set<string>> {
    const version = await this.currentVersion();
    const cacheKey = `rbac:perms:${adminUserId}:${version}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return new Set(JSON.parse(cached) as string[]);
      }
    } catch {
      // fall through to DB
    }

    const keys = await this.computeFromDb(adminUserId);

    try {
      await this.redis.set(cacheKey, JSON.stringify([...keys]), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // best-effort cache write
    }
    return keys;
  }

  private async currentVersion(): Promise<number> {
    try {
      const raw = await this.redis.get(ROLE_VERSION_KEY);
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  }

  private async computeFromDb(adminUserId: string): Promise<Set<string>> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!admin) {
      return new Set();
    }

    const effective = new Set<string>(admin.role.permissions.map((rp) => rp.permission.key));
    for (const override of admin.permissionOverrides) {
      if (override.effect === 'GRANT') {
        effective.add(override.permission.key);
      } else {
        effective.delete(override.permission.key);
      }
    }
    return effective;
  }
}
