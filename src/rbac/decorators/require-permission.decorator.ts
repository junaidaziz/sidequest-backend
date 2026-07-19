import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Marks a route as requiring one or more permission keys. Semantics are ALL by
 * default — the admin must hold every listed permission. Enforced by
 * PermissionGuard (which must run AFTER AdminJwtAuthGuard).
 *
 * @example @RequirePermission('admins.manage')
 * @example @RequirePermission('roles.manage', 'roles.assign')
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
