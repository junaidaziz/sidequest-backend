import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationTargetType } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Target types a *regular user* may report. Deliberately a subset of
 * `ModerationTargetType`: `Mission` is excluded because missions are first-party
 * curated content, not user-generated — allowing user reports on them would let
 * the auto-escalation globally hide a seeded mission out of the generator pool.
 * Admin moderation can still act on any `ModerationTargetType`.
 */
export const USER_REPORTABLE_TARGET_TYPES = [
  ModerationTargetType.Completion,
  ModerationTargetType.UserTaskSubmission,
  ModerationTargetType.User,
] as const;

export type UserReportableTargetType = (typeof USER_REPORTABLE_TARGET_TYPES)[number];

/**
 * Body for `POST /reports` — a report filed by an authenticated end user against
 * another user's content or account. Filing a report hides the target from the
 * reporter's own view immediately (reporter-local hide); a second distinct
 * reporter on the same target triggers an automatic global hide.
 */
export class CreateReportDto {
  @ApiProperty({
    enum: USER_REPORTABLE_TARGET_TYPES,
    description: 'What kind of target is being reported',
  })
  @IsIn(USER_REPORTABLE_TARGET_TYPES)
  targetType!: UserReportableTargetType;

  @ApiProperty({
    format: 'uuid',
    description: 'Id of the completion / submission / user being reported',
  })
  @IsUUID()
  targetId!: string;

  @ApiProperty({
    minLength: 3,
    maxLength: 200,
    example: 'Inappropriate photo',
    description: 'Short reason for the report',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Optional free-text detail describing the problem',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  details?: string;
}
