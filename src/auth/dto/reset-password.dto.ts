import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload for `POST /auth/reset-password`. `newPassword` mirrors SignupDto's /
 * ChangePasswordDto's 8-72 policy so the password rules are identical everywhere
 * a consumer password is set. `token` is the raw single-use token from the
 * emailed reset link.
 */
export class ResetPasswordDto {
  @ApiProperty({ description: 'The raw reset token from the email link.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  @ApiProperty({
    example: 'my-new-s3cret-pass',
    minLength: 8,
    maxLength: 72,
    description: 'The replacement password; hashed with bcrypt server-side.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
