import { ApiProperty } from '@nestjs/swagger';

/** Result of a successful `PATCH /auth/password`. */
export class ChangePasswordResponseDto {
  @ApiProperty({
    example: true,
    description: 'Always true on a 200 — the password hash has been rotated.',
  })
  success!: boolean;
}
