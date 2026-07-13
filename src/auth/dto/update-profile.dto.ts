import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `PATCH /auth/me`. `displayName` is required here (unlike signup, where
 * it is optional) — this endpoint exists specifically to set it, so an empty or
 * missing value is a 400 rather than a silent no-op. Bounds mirror SignupDto's
 * `@MaxLength(50)`, with an added `@MinLength(1)` to reject the empty string.
 */
export class UpdateProfileDto {
  @ApiProperty({
    example: 'Ada',
    minLength: 1,
    maxLength: 50,
    description: 'New public display name (1-50 characters).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName!: string;
}
