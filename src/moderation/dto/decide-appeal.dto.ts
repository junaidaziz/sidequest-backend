import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppealStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The terminal `AppealStatus` values a reviewer can decide an appeal to. `Pending`
 * is excluded — an appeal starts Pending and a decision moves it to Upheld
 * (the underlying action is reversed) or Denied (the action stands). The service
 * rejects deciding an already-decided appeal with a 409.
 */
export const APPEAL_DECISIONS = [AppealStatus.Upheld, AppealStatus.Denied] as const;

export type AppealDecision = (typeof APPEAL_DECISIONS)[number];

/**
 * Body for `PATCH /admin/appeals/:id`. An `Upheld` decision reverses the
 * underlying `ModerationAction` (sets `reversedAt`) and, if that action was a
 * suspension/ban, reactivates the user via the Phase 8 reactivate logic.
 */
export class DecideAppealDto {
  @ApiProperty({
    enum: APPEAL_DECISIONS,
    description: 'Uphold the appeal (reverse the action) or deny it (the action stands)',
  })
  @IsIn(APPEAL_DECISIONS)
  decision!: AppealDecision;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Optional note explaining the decision; stored on the appeal and audited',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  decisionNote?: string;
}
