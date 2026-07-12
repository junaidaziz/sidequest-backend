import { ApiProperty } from '@nestjs/swagger';

/**
 * Feeds the mobile Completion screen's shareable achievement card. `proofUrl`
 * is a short-lived presigned GET URL for photo proofs, and null for text proofs.
 */
export class ProofResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Id of the created Completion row.' })
  completionId!: string;

  @ApiProperty({ example: 'Find the Oldest Thing' })
  missionTitle!: string;

  @ApiProperty({ example: 40, description: 'XP this completion awarded (Mission.xpReward).' })
  xpAwarded!: number;

  @ApiProperty({ example: 240, description: "User's new lifetime total XP." })
  totalXp!: number;

  @ApiProperty({ example: 3, description: 'Consecutive-UTC-day streak after this completion.' })
  currentStreak!: number;

  @ApiProperty({ example: 7, description: 'Best streak ever reached.' })
  longestStreak!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://s3.example.com/proofs/…?X-Amz-Signature=…',
    description: 'Presigned GET URL for photo proofs; null for text proofs.',
  })
  proofUrl!: string | null;
}
