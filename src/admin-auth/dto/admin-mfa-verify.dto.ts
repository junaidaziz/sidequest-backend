import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Confirms the first TOTP code during MFA enrollment, flipping mfaEnabled on. */
export class AdminMfaVerifyDto {
  @ApiProperty({ description: 'The 6-digit code from the authenticator app' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
