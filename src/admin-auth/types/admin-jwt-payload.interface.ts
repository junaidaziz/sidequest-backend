/**
 * Discriminates admin access tokens from refresh tokens. Deliberately a SEPARATE
 * enum from the user-auth `TokenType` so the two auth surfaces can never be
 * confused, even though the string values coincide.
 */
export enum AdminTokenType {
  Access = 'access',
  Refresh = 'refresh',
}

/**
 * Signed admin JWT payload. `sid` is the AdminSession id — the strategy re-reads
 * that session on every request and rejects it if revoked/expired, which is what
 * makes forced-logout-all immediate (closes W2 for the admin surface).
 */
export interface AdminJwtPayload {
  /** Subject — the AdminUser id. */
  sub: string;
  /** AdminSession id, looked up on every request for per-request revocation. */
  sid: string;
  /** Token kind — enforced by the strategy and the refresh flow. */
  type: AdminTokenType;
}

/**
 * The authenticated admin principal attached to `request.user` by the admin-jwt
 * strategy and surfaced to controllers via `@CurrentAdmin()`.
 */
export interface AuthAdmin {
  adminUserId: string;
  email: string;
  roleId: string;
  sessionId: string;
  /**
   * True when the admin's role requires MFA but they have not enrolled yet —
   * they are routed to an enrollment-only state and blocked from permission-gated
   * routes until enrolled.
   */
  mfaPending: boolean;
  /** True until a first-login password change is completed (bootstrap Owner / invited admins). */
  mustChangePassword: boolean;
}
