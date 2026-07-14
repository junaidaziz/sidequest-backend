import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/** The two decisions a creator can make on a pending CREATOR_APPROVAL submission. */
export const REVIEW_DECISIONS = ['Approve', 'Reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Creator's decision on a pending submission. Mirrors UpdateVerificationDto:
 * `rejectionReason` is validated (and therefore required) only when rejecting,
 * so an approval needs no reason and any reason sent with one is ignored.
 */
export class ReviewSubmissionDto {
  @ApiProperty({ enum: REVIEW_DECISIONS, description: 'Approve or Reject the submission.' })
  @IsIn(REVIEW_DECISIONS)
  decision!: ReviewDecision;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Reason for rejection. Required when decision is Reject; ignored on Approve.',
  })
  @ValidateIf((dto: ReviewSubmissionDto) => dto.decision === 'Reject')
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rejectionReason?: string;
}
