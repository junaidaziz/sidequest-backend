import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogPageDto } from './dto/audit-log-response.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { AuditResult, RecordAuditParams } from './types/audit';

/**
 * Append-only audit trail writer (Phase 4). A leaf service other admin modules
 * call via DI from every mutating action (login attempts, MFA enroll/verify,
 * session revocation, admin invite/edit/disable, role/permission edits).
 *
 * Immutability is by construction: this service only ever creates rows, and no
 * update/delete method — nor GET-side mutation route — is ever built against
 * AuditLog. That is the entire immutability guarantee.
 *
 * `record()` is best-effort: an audit-write failure is logged and swallowed so
 * it can never fail the primary action it is auditing (same convention as the
 * notification/referral side-effect hooks elsewhere).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: RecordAuditParams): Promise<void> {
    try {
      await this.buildRecord(params);
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for action "${params.action}"`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Returns the un-awaited `PrismaPromise` for the audit insert instead of running
   * it best-effort. This lets a caller enlist the audit write in the SAME
   * `prisma.$transaction([...])` as the primary mutation, so a transient audit
   * failure rolls the mutation back rather than leaving an un-audited change
   * committed — used by the CMS/app-config modules, where audit-trail integrity
   * for admin content edits is treated as a correctness requirement, not a
   * best-effort side effect. `record()` (above) keeps the best-effort behavior for
   * callers that prefer it (auth attempts, etc.).
   */
  buildRecord(params: RecordAuditParams): Prisma.PrismaPromise<unknown> {
    return this.prisma.auditLog.create({
      data: {
        adminUserId: params.actorAdminUserId,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        previousValue: this.toJson(params.previousValue),
        // result/reason have no dedicated columns on the minimal, immutable
        // Phase-3 model — fold them into newValue under reserved keys so they
        // stay queryable (JSON path) without a schema change.
        newValue: this.buildNewValue(params.newValue, params.result, params.reason),
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  }

  /** Paginated, filterable, read-only list. No mutation counterpart exists — by design. */
  async list(query: QueryAuditLogsDto): Promise<AuditLogPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.AuditLogWhereInput = {};
    if (query.actorAdminUserId) {
      where.adminUserId = query.actorAdminUserId;
    }
    if (query.targetType) {
      where.targetType = query.targetType;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        where.createdAt.gte = new Date(query.from);
      }
      if (query.to) {
        where.createdAt.lte = new Date(query.to);
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map((entry) => ({
        id: entry.id,
        adminUserId: entry.adminUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        createdAt: entry.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  private buildNewValue(
    newValue: Prisma.InputJsonValue | null | undefined,
    result: AuditResult,
    reason: string | null | undefined,
  ): Prisma.InputJsonValue {
    const meta: Record<string, unknown> = { __result: result };
    if (reason) {
      meta.__reason = reason;
    }
    if (newValue !== null && newValue !== undefined && typeof newValue === 'object') {
      return { ...(newValue as Record<string, unknown>), ...meta } as Prisma.InputJsonValue;
    }
    if (newValue !== null && newValue !== undefined) {
      // A non-object domain value (rare) is preserved under a `value` key.
      return { value: newValue, ...meta } as Prisma.InputJsonValue;
    }
    return meta as Prisma.InputJsonValue;
  }

  private toJson(
    value: Prisma.InputJsonValue | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return value === null || value === undefined ? Prisma.JsonNull : value;
  }
}
