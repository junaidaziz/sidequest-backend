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
