import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The `ReportStatus` values a moderator can transition a report *to*. `Open` is
 * deliberately excluded — a report starts Open and only ever moves forward
 * (Open -> UnderReview -> Resolved/Dismissed); re-opening a resolved report is not
 * a supported transition. The service enforces that Resolved/Dismissed are
 * terminal (a further transition is a 409).
 */
export const REPORT_TRANSITION_TARGETS = [
  ReportStatus.UnderReview,
  ReportStatus.Resolved,
  ReportStatus.Dismissed,
] as const;

export type ReportTransitionTarget = (typeof REPORT_TRANSITION_TARGETS)[number];

/**
 * Body for `PATCH /admin/reports/:id` — a triage-status transition, optionally
 * accompanied by a resolution note recorded on the report and in the audit log.
 */
export class UpdateReportDto {
  @ApiProperty({
    enum: REPORT_TRANSITION_TARGETS,
    description: 'The status to transition the report to (cannot move a report back to Open)',
  })
  @IsIn(REPORT_TRANSITION_TARGETS)
  status!: ReportTransitionTarget;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Optional moderator note explaining the resolution; stored on the report',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  resolutionNote?: string;
}
