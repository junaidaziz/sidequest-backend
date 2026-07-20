import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AppealStatus,
  ModerationActionType,
  ModerationTargetType,
  ProofType,
  ReportStatus,
  TaskSubmissionStatus,
  VerificationStatus,
} from '@prisma/client';
import { ModerationQueueSource } from '../types/moderation';

/**
 * One row in the unified moderation queue. A `Completion` and a
 * `UserTaskSubmission` are projected onto this common shape, discriminated by
 * `source`; the type-specific fields (`proofType`/`proofText` vs. `notes`) are
 * nullable and populated per source.
 */
export class ModerationQueueItemDto {
  @ApiProperty({ enum: ModerationQueueSource, description: 'Which submission type this row is' })
  source!: ModerationQueueSource;

  @ApiProperty({ format: 'uuid', description: 'Completion id or UserTaskSubmission id' })
  id!: string;

  @ApiProperty({ enum: ModerationTargetType, description: 'How to report/action this item' })
  targetType!: ModerationTargetType;

  @ApiProperty({ format: 'uuid', description: 'The user who made the submission' })
  submittedById!: string;

  @ApiPropertyOptional({ nullable: true, description: 'The submitter’s display name, if any' })
  submitterDisplayName!: string | null;

  @ApiProperty({ description: 'Mission title (completion) or task title (task submission)' })
  title!: string;

  @ApiProperty({ description: 'Current review status (Pending / Submitted)' })
  status!: VerificationStatus | TaskSubmissionStatus;

  @ApiPropertyOptional({
    enum: ProofType,
    nullable: true,
    description: 'Completion proof type; null for task submissions',
  })
  proofType!: ProofType | null;

  @ApiPropertyOptional({ nullable: true, description: 'Text proof or submission notes' })
  proofText!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Presigned URL for the primary proof/evidence media, if any',
  })
  proofUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'XP awarded (completions only)' })
  xpAwarded!: number | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the item was submitted' })
  submittedAt!: Date;
}

/** Paginated envelope for the unified moderation queue. */
export class ModerationQueuePageDto {
  @ApiProperty({ type: [ModerationQueueItemDto] })
  items!: ModerationQueueItemDto[];

  @ApiProperty({ description: 'Total pending items across both sources (respecting the filter)' })
  total!: number;

  @ApiProperty({ description: 'Pending Completion rows in scope' })
  pendingCompletions!: number;

  @ApiProperty({ description: 'Pending UserTaskSubmission rows in scope' })
  pendingTaskSubmissions!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/** One row in the paginated `GET /admin/reports` result. */
export class ReportListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  reporterUserId!: string | null;

  @ApiProperty({ enum: ModerationTargetType })
  targetType!: ModerationTargetType;

  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @ApiProperty()
  reason!: string;

  @ApiPropertyOptional({ nullable: true })
  details!: string | null;

  @ApiProperty({ enum: ReportStatus })
  status!: ReportStatus;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  reviewedByAdminId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  reviewedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** Paginated envelope for the report list. */
export class ReportPageDto {
  @ApiProperty({ type: [ReportListItemDto] })
  items!: ReportListItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/** A moderation action, as embedded in a report detail or listed on its own. */
export class ModerationActionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  reportId!: string | null;

  @ApiProperty({ format: 'uuid' })
  adminUserId!: string;

  @ApiProperty({ enum: ModerationActionType })
  actionType!: ModerationActionType;

  @ApiProperty({ enum: ModerationTargetType })
  targetType!: ModerationTargetType;

  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  targetUserId!: string | null;

  @ApiProperty()
  reason!: string;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  expiresAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  reversedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** Full report view (`GET /admin/reports/:id`) including its moderation actions. */
export class ReportDetailDto extends ReportListItemDto {
  @ApiPropertyOptional({ nullable: true, description: 'Free-text detail supplied by the reporter' })
  declare details: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Moderator resolution note' })
  resolutionNote!: string | null;

  @ApiProperty({ type: [ModerationActionSummaryDto], description: 'Actions taken for this report' })
  actions!: ModerationActionSummaryDto[];
}

/** Paginated envelope for the moderation-action history. */
export class ModerationActionPageDto {
  @ApiProperty({ type: [ModerationActionSummaryDto] })
  items!: ModerationActionSummaryDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/** One row in the paginated `GET /admin/appeals` result, with its action embedded. */
export class AppealListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  moderationActionId!: string;

  @ApiProperty({ format: 'uuid' })
  appellantUserId!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ enum: AppealStatus })
  status!: AppealStatus;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  reviewedByAdminId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  decisionNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: ModerationActionSummaryDto, description: 'The action being appealed' })
  moderationAction!: ModerationActionSummaryDto;
}

/** Paginated envelope for the appeal list. */
export class AppealPageDto {
  @ApiProperty({ type: [AppealListItemDto] })
  items!: AppealListItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/**
 * The completion's verification fields after an admin decision on the RBAC-gated
 * proof-review route. Extends the legacy route's response shape with the real
 * `verifiedByAdminId` FK (the legacy route left it null and only set the free-text
 * `verifiedBy`).
 */
export class ProofReviewResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Id of the updated Completion row.' })
  completionId!: string;

  @ApiProperty({ enum: VerificationStatus, description: 'New verification status.' })
  verificationStatus!: VerificationStatus;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  verifiedAt!: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'admin',
    description:
      "Free-text verifier identity, kept for backward-compat ('admin' for a manual override).",
  })
  verifiedBy!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Real FK to the admin who verified this completion (set by the new RBAC route).',
  })
  verifiedByAdminId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Reason supplied when rejected.' })
  rejectionReason!: string | null;
}
