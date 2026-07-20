import { ApiProperty } from '@nestjs/swagger';

/** An admin account as returned by the management endpoints (no secrets). */
export class AdminUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: ['Invited', 'Active', 'Suspended'] })
  status!: string;

  @ApiProperty()
  roleId!: string;

  @ApiProperty()
  roleKey!: string;

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiProperty()
  mustChangePassword!: boolean;

  @ApiProperty({ nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty({
    description:
      'Whether the account is currently locked (never the exact expiry — see security review)',
  })
  isLocked!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

/** A permission catalog entry (read-only, seed-defined). */
export class PermissionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  category!: string;
}

/**
 * The caller's own profile, role, and effective permission set — powers the
 * web admin portal's BFF `/api/admin/session` endpoint (client-side nav
 * gating). Deliberately NOT gated by `admins.view` (unlike `GET /admin/admins/:id`)
 * since every admin — regardless of role — must be able to learn their own
 * effective permissions to render the shell; see `AdminManagementController.getSelf`.
 */
export class AdminMeDto extends AdminUserDto {
  @ApiProperty({
    type: [String],
    description: "The caller's effective permission keys (role permissions ± overrides)",
  })
  permissions!: string[];

  @ApiProperty({
    description: 'True when the role requires MFA but enrollment is not yet complete',
  })
  mfaEnrollmentRequired!: boolean;
}

/**
 * A single per-admin permission override, as returned by the override endpoints.
 * `permissionKey` is the stable catalog key (never the internal permission id).
 * `effect` GRANT adds the permission; REVOKE subtracts it even if the role grants
 * it. Absence of an override row for a permission means "defer to the role" — a
 * distinct state from a REVOKE row.
 */
export class PermissionOverrideDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The admin this override applies to' })
  adminUserId!: string;

  @ApiProperty({ description: 'Stable catalog permission key, e.g. "users.suspend"' })
  permissionKey!: string;

  @ApiProperty({ enum: ['GRANT', 'REVOKE'] })
  effect!: string;

  @ApiProperty({ nullable: true, description: 'Optional justification captured at write time' })
  reason!: string | null;

  @ApiProperty({ nullable: true, description: 'Admin id that last set this override, if known' })
  grantedByAdminId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** A role plus its permission set. */
export class RoleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty()
  isSystem!: boolean;

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiProperty({ type: [String], description: 'Permission keys granted by this role' })
  permissionKeys!: string[];
}
