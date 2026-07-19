import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Public-safe admin profile returned alongside tokens. */
export class AdminProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  roleId!: string;

  @ApiProperty({ description: 'Role machine key, e.g. "owner"' })
  roleKey!: string;

  @ApiProperty({ description: 'True until first-login password change is completed' })
  mustChangePassword!: boolean;

  @ApiProperty({ description: 'True when MFA is enrolled and active' })
  mfaEnabled!: boolean;

  @ApiProperty({
    description: 'True when the role requires MFA but it is not yet enrolled — enrollment required',
  })
  mfaEnrollmentRequired!: boolean;
}

/**
 * Login result. `status` discriminates:
 *  - "authenticated": tokens + admin are present (MFA satisfied or not required).
 *  - "mfa_required": no tokens; complete MFA at /admin/auth/mfa/challenge with `challengeId`.
 */
export class AdminLoginResponseDto {
  @ApiProperty({ enum: ['authenticated', 'mfa_required'] })
  status!: 'authenticated' | 'mfa_required';

  @ApiPropertyOptional()
  accessToken?: string;

  @ApiPropertyOptional()
  refreshToken?: string;

  @ApiPropertyOptional({ type: AdminProfileDto })
  admin?: AdminProfileDto;

  @ApiPropertyOptional({ description: 'Present when status = mfa_required' })
  challengeId?: string;
}

/** Token pair + profile, returned by challenge/refresh/invite-accept. */
export class AdminTokenPairDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ type: AdminProfileDto })
  admin!: AdminProfileDto;
}
