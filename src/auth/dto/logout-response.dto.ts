import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of a logout. `success` is always `true` on a 200 response — logout is
 * idempotent: revoking an already-revoked (null) refresh-token hash is a no-op
 * that still succeeds, so a client can safely retry without special-casing.
 */
export class LogoutResponseDto {
  @ApiProperty({
    example: true,
    description: 'Always true — the server-side refresh token has been revoked.',
  })
  success!: boolean;
}
