import { ApiProperty } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';

/**
 * The completion's verification fields after an admin decision is applied.
 * Deliberately narrow — proof media/keys are not echoed back on the admin route.
 */
export class VerificationResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Id of the updated Completion row.' })
  completionId!: string;

  @ApiProperty({ enum: VerificationStatus, description: 'New verification status.' })
  verificationStatus!: VerificationStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'When the decision was applied; null if never verified.',
  })
  verifiedAt!: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'admin',
    description:
      "Identity that verified — 'admin' for a manual override, 'auto' for the timeout job.",
  })
  verifiedBy!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Reason supplied when rejected; null otherwise.',
  })
  rejectionReason!: string | null;
}
