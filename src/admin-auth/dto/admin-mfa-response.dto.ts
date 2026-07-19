import { ApiProperty } from '@nestjs/swagger';

/** MFA enrollment setup material, shown once so the admin can add it to their app. */
export class AdminMfaSetupResponseDto {
  @ApiProperty({ description: 'Base32 TOTP secret (also encoded in the otpauth URL)' })
  secret!: string;

  @ApiProperty({ description: 'otpauth:// provisioning URI to render as a QR code' })
  otpauthUrl!: string;
}

/** Recovery codes returned exactly once after MFA verification. */
export class AdminMfaVerifyResponseDto {
  @ApiProperty({
    type: [String],
    description: '10 one-time recovery codes — shown once, then hashed',
  })
  recoveryCodes!: string[];
}
