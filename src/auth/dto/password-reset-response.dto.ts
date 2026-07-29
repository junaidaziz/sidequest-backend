import { ApiProperty } from '@nestjs/swagger';

/**
 * Generic success response shared by `POST /auth/forgot-password` and
 * `POST /auth/reset-password`. The forgot-password variant always returns
 * `success: true` (even for an unknown email) to avoid account enumeration; the
 * reset variant returns it only after the token is validated and the password
 * rotated.
 */
export class PasswordResetResponseDto {
  @ApiProperty({ example: true, description: 'Always true on a 200 response.' })
  success!: boolean;
}
