import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload for `PATCH /auth/password` (M22.1). `currentPassword` is only length-
 * bounded (never min-length-validated) because it must accept whatever the user
 * originally set — re-tightening the rule here would lock legacy passwords out
 * of ever being changed. `newPassword` mirrors SignupDto's 8-72 policy so the
 * password rules are identical everywhere a password is set.
 */
export class ChangePasswordDto {
  @ApiProperty({
    example: 'my-current-pass',
    maxLength: 72,
    description: "The account's current password, bcrypt-verified server-side.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  currentPassword!: string;

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
