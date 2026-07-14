import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload for `DELETE /auth/me` (M22.2). Account deletion is destructive-feeling
 * from the user's perspective, so it requires re-authentication in the request:
 *
 *  - A password account MUST supply `currentPassword` (bcrypt-verified).
 *  - A Google-only or guest account (no `passwordHash`) has no password to
 *    verify, so it MUST instead supply `confirm: true` to prove intent.
 *
 * The service picks which check applies from the account's `passwordHash`, so
 * both fields are optional at the DTO layer and enforced conditionally there.
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({
    example: 'my-current-pass',
    maxLength: 72,
    description:
      'Required for password accounts — the current password, bcrypt-verified. ' +
      'Ignored for accounts with no password (use `confirm` instead).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(72)
  currentPassword?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Required (must be true) for Google-only / guest accounts with no password, ' +
      'to confirm deletion intent. Ignored for password accounts.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
