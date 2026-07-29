import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Payload for `POST /auth/forgot-password`. The endpoint always returns a generic
 * 200 regardless of whether this email maps to an account, so nothing here can
 * leak account existence. Email is normalized identically to SignupDto so a
 * casing/whitespace variant still resolves to the same row.
 */
export class ForgotPasswordDto {
  @ApiProperty({
    example: 'adventurer@example.com',
    description: 'Email address the reset link should be sent to (if an account exists).',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
