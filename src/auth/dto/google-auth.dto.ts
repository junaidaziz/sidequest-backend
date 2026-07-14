import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
    description:
      'Google-issued OpenID Connect ID token obtained client-side via Google Sign-In. ' +
      'Verified server-side against the configured web/iOS OAuth client IDs.',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiProperty({
    required: false,
    example: 'H7KMNP34',
    description:
      'Optional referral code the user arrived with (M20). Validated server-side; ' +
      'an invalid code is a 400. Only attributed when this Google sign-in creates a ' +
      'new account or upgrades a guest in place — never for a returning user.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
