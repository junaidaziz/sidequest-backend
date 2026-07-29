import { ApiProperty } from '@nestjs/swagger';
import { ModerationTargetType, ReportStatus } from '@prisma/client';

/**
 * Response for `POST /reports`. Confirms the report was filed and reports the
 * resulting visibility effect: the target is always hidden for the reporter
 * (`hiddenForReporter`), and `globallyHidden` is true once the target has been
 * hidden for everyone (a second distinct user reported the same target).
 */
export class CreateReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  reportId!: string;

  @ApiProperty({ enum: ReportStatus })
  status!: ReportStatus;

  @ApiProperty({
    enum: [
      ModerationTargetType.Completion,
      ModerationTargetType.UserTaskSubmission,
      ModerationTargetType.User,
    ],
  })
  targetType!: ModerationTargetType;

  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @ApiProperty({
    description: 'Always true — the target is now hidden from the reporter’s own view',
  })
  hiddenForReporter!: boolean;

  @ApiProperty({
    description:
      'True once the target is hidden for everyone (escalated by a second distinct reporter)',
  })
  globallyHidden!: boolean;

  @ApiProperty()
  createdAt!: Date;
}
