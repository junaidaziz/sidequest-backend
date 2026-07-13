import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';
import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Admin decision on a Pending completion. An admin can only resolve a
 * completion to Approved or Rejected — never back to Pending — so `status` is
 * constrained to that pair, not the full VerificationStatus enum.
 */
export type AdminVerificationStatus =
  typeof VerificationStatus.Approved | typeof VerificationStatus.Rejected;

export class UpdateVerificationDto {
  @ApiProperty({
    enum: [VerificationStatus.Approved, VerificationStatus.Rejected],
    description: 'Resolution to apply to the completion.',
  })
  @IsIn([VerificationStatus.Approved, VerificationStatus.Rejected])
  status!: AdminVerificationStatus;

  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Reason for rejection. Required when status is Rejected; ignored when ' +
      'status is Approved.',
  })
  // Only validated (and thus only required) when rejecting. When approving,
  // ValidateIf short-circuits so an omitted reason is fine and any supplied
  // value is ignored by the service.
  @ValidateIf((dto: UpdateVerificationDto) => dto.status === VerificationStatus.Rejected)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rejectionReason?: string;
}
