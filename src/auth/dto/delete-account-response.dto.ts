import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of a successful `DELETE /auth/me`. The account is soft-deleted, so the
 * caller's existing access token stops working immediately (JwtStrategy rejects
 * tokens for `deletedAt`-set users) and the client should drop to the guest
 * onboarding flow.
 */
export class DeleteAccountResponseDto {
  @ApiProperty({
    example: true,
    description: 'Always true on a 200 — the account has been soft-deleted and anonymized.',
  })
  success!: boolean;
}
