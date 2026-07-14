import { ApiProperty } from '@nestjs/swagger';

/** Counts for tasks the caller created. */
export class CreatedTaskSummaryDto {
  @ApiProperty({ description: 'Total non-deleted tasks the caller created.' })
  total!: number;

  @ApiProperty({ description: 'Tasks with no assignee yet (Open).' })
  open!: number;

  @ApiProperty({ description: 'Tasks with an outstanding invite (Invited).' })
  invited!: number;

  @ApiProperty({ description: 'Submissions awaiting the caller’s review (Submitted).' })
  awaitingMyReview!: number;

  @ApiProperty({ description: 'Tasks completed and approved.' })
  approved!: number;
}

/** Counts for tasks assigned to the caller. */
export class AssignedTaskSummaryDto {
  @ApiProperty({ description: 'Total non-deleted tasks assigned to the caller.' })
  total!: number;

  @ApiProperty({ description: 'Active tasks accepted by the caller (Accepted).' })
  active!: number;

  @ApiProperty({
    description: 'Submissions the caller made that await creator review (Submitted).',
  })
  awaitingReview!: number;

  @ApiProperty({ description: 'Tasks rejected and awaiting the caller’s resubmission (Rejected).' })
  needsResubmission!: number;

  @ApiProperty({ description: 'Tasks the caller completed and had approved.' })
  approved!: number;
}

/**
 * Dashboard-style task counts for the current user. A dedicated endpoint rather
 * than a `GET /home` extension (Decision 11), so it never destabilizes the
 * manually-mirrored HomeResponse contract.
 */
export class TaskSummaryDto {
  @ApiProperty({ type: CreatedTaskSummaryDto })
  created!: CreatedTaskSummaryDto;

  @ApiProperty({ type: AssignedTaskSummaryDto })
  assigned!: AssignedTaskSummaryDto;
}
