import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ModerationActionType,
  ProofType,
  ReportStatus,
  UserTaskStatus,
  VerificationStatus,
} from '@prisma/client';
import { RestrictableFeature, UserAccountStatus } from '../admin-users.constants';

/** One row in the paginated `GET /admin/users` result. */
export class AdminUserListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiProperty()
  isGuest!: boolean;

  @ApiProperty({ enum: UserAccountStatus })
  status!: UserAccountStatus;

  @ApiProperty()
  totalXp!: number;

  @ApiProperty({ description: 'Level derived from totalXp (never stored)' })
  level!: number;

  @ApiProperty()
  currentStreak!: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lastCompletionDate!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  suspendedAt!: Date | null;
}

/** Paginated envelope for the user list. */
export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserListItemDto] })
  items!: AdminUserListItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/** A single proof/completion in the user's history. */
export class AdminUserProofDto {
  @ApiProperty({ format: 'uuid' })
  completionId!: string;

  @ApiProperty({ format: 'uuid' })
  missionId!: string;

  @ApiProperty()
  missionTitle!: string;

  @ApiProperty({ enum: ProofType })
  proofType!: ProofType;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Short-lived presigned URL, null when de-referenced/absent',
  })
  proofUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  proofText!: string | null;

  @ApiProperty()
  xpAwarded!: number;

  @ApiProperty({ enum: VerificationStatus })
  verificationStatus!: VerificationStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  completedAt!: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  verifiedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  rejectionReason!: string | null;
}

/** A challenge (UserTask) the user created or was assigned. */
export class AdminUserChallengeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['creator', 'assignee'], description: "The user's role on this challenge" })
  role!: 'creator' | 'assignee';

  @ApiProperty({ enum: UserTaskStatus })
  status!: UserTaskStatus;

  @ApiPropertyOptional({ nullable: true })
  rewardXp!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** A report filed against the user (Phase 3 schema; typically empty until Phase 10). */
export class AdminUserReportDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ enum: ReportStatus })
  status!: ReportStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** A moderation action taken against the user (typically empty until Phase 10). */
export class AdminUserModerationActionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ModerationActionType })
  actionType!: ModerationActionType;

  @ApiProperty()
  reason!: string;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  reversedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** Moderation/report history for the user. Empty arrays until Phase 10 writes them. */
export class AdminUserModerationHistoryDto {
  @ApiProperty({ type: [AdminUserReportDto] })
  reportsAgainst!: AdminUserReportDto[];

  @ApiProperty({ type: [AdminUserModerationActionDto] })
  actionsAgainst!: AdminUserModerationActionDto[];
}

/** Full admin view of a single end-user (`GET /admin/users/:id`). */
export class AdminUserDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiProperty()
  isGuest!: boolean;

  @ApiProperty({ enum: UserAccountStatus })
  status!: UserAccountStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Presigned avatar URL, null when unset' })
  avatarUrl!: string | null;

  @ApiProperty()
  totalXp!: number;

  @ApiProperty()
  level!: number;

  @ApiProperty()
  currentStreak!: number;

  @ApiProperty()
  longestStreak!: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lastCompletionDate!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  suspendedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  suspensionReason!: string | null;

  @ApiProperty({ enum: RestrictableFeature, isArray: true })
  restrictedFeatures!: RestrictableFeature[];

  @ApiProperty({ type: [AdminUserProofDto] })
  proofHistory!: AdminUserProofDto[];

  @ApiProperty({ type: [AdminUserChallengeDto] })
  challenges!: AdminUserChallengeDto[];

  @ApiProperty({ type: AdminUserModerationHistoryDto })
  moderation!: AdminUserModerationHistoryDto;
}

/** Confirmation returned by `POST /admin/users/:id/reset-verification`. */
export class ResetVerificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  completionId!: string;

  @ApiProperty({ enum: VerificationStatus })
  verificationStatus!: VerificationStatus;
}

/** Aggregate referral counts included in a user data export. */
export class AdminUserReferralSummaryDto {
  @ApiProperty({ description: 'Number of referral codes the user owns' })
  codesMade!: number;

  @ApiProperty({ description: 'Number of successful referral conversions attributed to the user' })
  conversions!: number;

  @ApiProperty({ description: 'Number of referral rewards the user earned' })
  rewardsEarned!: number;
}

/**
 * The user-data export (`GET /admin/users/:id/export`). Covers the same scope the
 * self-service deletion anonymizes/nulls (profile identity + proof/evidence
 * media) plus the user's activity records, for the "export user information when
 * legally permitted" requirement. Media keys are resolved to short-lived
 * presigned URLs so the export is directly usable.
 */
export class AdminUserExportDto {
  @ApiProperty({ description: 'The full admin detail view of the user', type: AdminUserDetailDto })
  profile!: AdminUserDetailDto;

  @ApiProperty({ type: String, format: 'date-time', description: 'When this export was generated' })
  exportedAt!: Date;

  @ApiProperty({ description: 'Referral summary counts', type: AdminUserReferralSummaryDto })
  referrals!: AdminUserReferralSummaryDto;
}
