import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Admin decision on a Pending completion, for the RBAC-gated proof-review route
 * (`PATCH /admin/proofs/:id/verification`, `proofs.review`). This is the exact
 * shape of the legacy `x-admin-key` route's `UpdateVerificationDto` — deliberately
 * a byte-for-byte behavioral clone so the Phase 10 cutover swaps only the auth
 * gate, never the request contract. An admin can only resolve to Approved or
 * Rejected, never back to Pending.
 */
export type ProofReviewStatus =
  typeof VerificationStatus.Approved | typeof VerificationStatus.Rejected;

export class ReviewProofDto {
  @ApiProperty({
    enum: [VerificationStatus.Approved, VerificationStatus.Rejected],
    description: 'Resolution to apply to the completion.',
  })
  @IsIn([VerificationStatus.Approved, VerificationStatus.Rejected])
  status!: ProofReviewStatus;

  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Reason for rejection. Required when status is Rejected; ignored when status is Approved.',
  })
  // Only validated (and thus only required) when rejecting — identical to the
  // legacy route's ValidateIf, so an omitted reason on Approved is fine and a
  // supplied value is ignored by the service.
  @ValidateIf((dto: ReviewProofDto) => dto.status === VerificationStatus.Rejected)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rejectionReason?: string;
}
