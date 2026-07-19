import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsAdminPassword } from '../validators/admin-password.validator';

/** Completes a password reset with the emailed token and a policy-compliant password. */
export class AdminResetPasswordDto {
  @ApiProperty({ description: 'The raw reset token from the email link' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  @ApiProperty({ description: '12+ chars, at least 3 of 4 character classes' })
  @IsAdminPassword()
  newPassword!: string;
}
