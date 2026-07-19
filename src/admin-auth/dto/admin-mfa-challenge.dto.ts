import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Completes a pending MFA login. `challengeId` references the short-lived
 * password-verified state (held in Redis); `code` is either a 6-digit TOTP code
 * or a one-time recovery code.
 */
export class AdminMfaChallengeDto {
  @ApiProperty({ description: 'The challengeId returned by /admin/auth/login' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  challengeId!: string;

  @ApiProperty({ description: 'A 6-digit TOTP code or a recovery code' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  code!: string;
}
