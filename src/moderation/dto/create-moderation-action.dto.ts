import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationActionType } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for `POST /admin/reports/:id/actions` — records a `ModerationAction` linked
 * to the report and, for user-directed types, applies it to the target user.
 *
 * `targetUserId` is optional: by default the target user is resolved from the
 * report's target (a reported User is the target directly; a reported Completion /
 * UserTaskSubmission resolves to its author). It can be supplied explicitly to
 * override that resolution (e.g. acting on a specific user behind reported content).
 *
 * `expiresAt` is only meaningful for a time-boxed `SuspendUser`; it is stored on
 * the action for the record and repeat-offender history.
 */
export class CreateModerationActionDto {
  @ApiProperty({ enum: ModerationActionType, description: 'The moderation decision to record' })
  @IsEnum(ModerationActionType)
  actionType!: ModerationActionType;

  @ApiProperty({ maxLength: 1000, description: 'Why the action was taken (required, audited)' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Explicit target user; defaults to the user resolved from the report target',
  })
  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Expiry for a time-boxed suspension (ISO-8601); omit for a permanent action',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
