import { ApiProperty } from '@nestjs/swagger';
import { MissionCategory, MissionDifficulty } from '@prisma/client';

/**
 * A single mission as the mobile client expects it. The short field names
 * (desc/full/proof/time/xp) intentionally differ from the DB column names
 * (description/fullBrief/proofRequirement/estimatedMinutes/xpReward) — the
 * mobile Mission interface in MissionResultsScreen.tsx uses these short names,
 * so do not rename them back to the column names.
 */
export class MissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: [MissionCategory.explore, MissionCategory.create, MissionCategory.discover],
  })
  category!: MissionCategory;

  @ApiProperty({ example: 'Find the Oldest Thing' })
  title!: string;

  @ApiProperty({ description: 'Short teaser (Mission.description).' })
  desc!: string;

  @ApiProperty({ description: 'Full brief (Mission.fullBrief).' })
  full!: string;

  @ApiProperty({ description: 'Proof requirement (Mission.proofRequirement).' })
  proof!: string;

  @ApiProperty({
    example: '20 min',
    description: 'Mission.estimatedMinutes formatted as "<N> min".',
  })
  time!: string;

  @ApiProperty({ example: '+40 XP', description: 'Mission.xpReward formatted as "+<N> XP".' })
  xp!: string;

  @ApiProperty({ enum: [MissionDifficulty.Easy, MissionDifficulty.Medium, MissionDifficulty.Hard] })
  diff!: MissionDifficulty;

  @ApiProperty({
    minimum: 1,
    maximum: 3,
    description: 'Filled difficulty dots (Mission.difficultyDots).',
  })
  dots!: number;
}

/** Up to 3 missions matching the requested onboarding context. */
export class GenerateMissionsResponseDto {
  @ApiProperty({ type: [MissionResponseDto] })
  missions!: MissionResponseDto[];
}
