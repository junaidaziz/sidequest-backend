import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({ nullable: true })
  lockedUntil!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

/** An admin account plus a one-time invite token (dev-only convenience). */
export class InvitedAdminDto extends AdminUserDto {
  @ApiPropertyOptional({
    description:
      'Raw invite token. Returned only while email delivery is a dev no-op; remove once a real ' +
      'email provider is wired. The invitee normally receives this via the emailed accept link.',
  })
  inviteToken?: string;
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
