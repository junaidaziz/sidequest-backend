import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskSubmissionStatus, TaskVerificationMethod, UserTaskStatus } from '@prisma/client';

/** A single piece of evidence attached to a submission. */
export class TaskAttachmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'photo', description: '"photo" or "document".' })
  kind!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Short-lived presigned GET URL for the object; null if it could not be signed.',
  })
  url!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

/** One evidence submission in a task's history. */
export class TaskSubmissionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'User who submitted this evidence.' })
  submittedById!: string;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ enum: TaskSubmissionStatus })
  status!: TaskSubmissionStatus;

  @ApiProperty({ format: 'date-time' })
  submittedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  reviewedById!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({ type: [TaskAttachmentDto] })
  attachments!: TaskAttachmentDto[];
}

/** A task as returned in list/detail views (submissions omitted in list view). */
export class TaskDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  creatorId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null for personal tasks.',
  })
  assigneeId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  rewardXp!: number | null;

  @ApiProperty({ enum: TaskVerificationMethod })
  verificationMethod!: TaskVerificationMethod;

  @ApiProperty()
  evidenceRequired!: boolean;

  @ApiProperty({ enum: UserTaskStatus })
  status!: UserTaskStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dueAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Full task detail: the task plus its submission/evidence history. */
export class TaskDetailDto extends TaskDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Active invite token — exposed to the creator only (null for the assignee ' +
      'and when no invite is outstanding).',
  })
  inviteToken!: string | null;

  @ApiProperty({ type: [TaskSubmissionDto] })
  submissions!: TaskSubmissionDto[];
}

/** Paginated, newest-created-first envelope for `GET /tasks`. */
export class PaginatedTasksDto {
  @ApiProperty({ type: [TaskDto] })
  items!: TaskDto[];

  @ApiProperty({ example: 42, description: "Total tasks matching the caller's filters." })
  total!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}
