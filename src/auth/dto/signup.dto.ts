import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({
    example: 'adventurer@example.com',
    description: 'Unique email address for the account.',
  })
  // Postgres' unique constraint is case-sensitive; normalize so
  // "User@Example.com" and "user@example.com" collide as intended.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'sup3r-s3cret-pass',
    minLength: 8,
    maxLength: 72,
    description: 'Plaintext password; hashed with bcrypt server-side.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({
    required: false,
    example: 'Ada',
    description: 'Optional public display name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  displayName?: string;

  @ApiProperty({
    required: false,
    example: 'H7KMNP34',
    description:
      'Optional referral code the user arrived with (M20). Validated server-side; ' +
      'an invalid code is a 400. Attributed through the same guest-upgrade-in-place ' +
      'path a pre-registration guest already follows.',
  })
  // Codes are uppercase; normalise so a pasted lowercase/whitespace-padded value
  // still matches. The real existence check happens in ReferralsService.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
