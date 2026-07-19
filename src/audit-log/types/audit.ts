import { Prisma } from '@prisma/client';

/** Outcome of an audited action — recorded on every audit entry. */
export enum AuditResult {
  Success = 'SUCCESS',
  Failure = 'FAILURE',
}

/**
 * Input to AuditLogService.record(). `result` and `reason` have no dedicated
 * columns on the Phase-3 AuditLog model (it is intentionally minimal + immutable),
 * so they are folded into the `newValue` JSON under reserved `__result`/`__reason`
 * keys at persistence time — see AuditLogService for the rationale.
 */
export interface RecordAuditParams {
  /** The acting admin's id; null for system-originated events. */
  actorAdminUserId: string | null;
  /** Dot-namespaced action key, mirroring permission keys (e.g. "admins.manage"). */
  action: string;
  /** Polymorphic target discriminator (e.g. "AdminUser", "Role"). */
  targetType?: string | null;
  /** Polymorphic target id. */
  targetId?: string | null;
  /** Before-snapshot for edits. */
  previousValue?: Prisma.InputJsonValue | null;
  /** After-snapshot for edits. */
  newValue?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  result: AuditResult;
  /** Optional human-readable reason (esp. for failures/denials). */
  reason?: string | null;
}
