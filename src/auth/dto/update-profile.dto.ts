import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsIanaTimeZone } from '../validators/is-iana-timezone.validator';

/**
 * Body for `PATCH /auth/me`. Every field is optional so a client can update just
 * one attribute (e.g. set `timezone` on first launch without touching the display
 * name); the global `ValidationPipe` still rejects any field outside this shape.
 * `displayName`, when present, keeps SignupDto's `@MaxLength(50)` bound plus a
 * `@MinLength(1)` so it can be *set* but never blanked to the empty string.
 * `timezone` is validated as a real IANA zone name (see `IsIanaTimeZone`) so the
 * per-user local-day streak logic (`ProofService`/`streak.util`) only ever
 * receives a zone the runtime's `Intl` database recognizes.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Ada',
    minLength: 1,
    maxLength: 50,
    description: 'New public display name (1-50 characters).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName?: string;

  @ApiPropertyOptional({
    example: 'America/New_York',
    description:
      'IANA timezone name used to compute the completion streak on the user’s local ' +
      'calendar day instead of the UTC day.',
  })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;
}
