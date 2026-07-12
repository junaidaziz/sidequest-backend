import { ApiProperty } from '@nestjs/swagger';
import { MissionResponseDto } from '../../missions/dto/mission-response.dto';

/** Derived XP/level progression for the Home screen's level ring. */
export class LevelDto {
  @ApiProperty({ example: 3, description: 'floor(totalXp / 100) + 1.' })
  level!: number;

  @ApiProperty({
    example: 50,
    description: 'XP accumulated within the current level (totalXp % 100).',
  })
  xpIntoLevel!: number;

  @ApiProperty({
    example: 50,
    description: 'XP still needed to reach the next level (100 - xpIntoLevel).',
  })
  xpToNextLevel!: number;

  @ApiProperty({ example: 250, description: 'Lifetime XP total this was derived from.' })
  totalXp!: number;
}

/** The user's streak counters, surfaced verbatim from the User row. */
export class StreakDto {
  @ApiProperty({ example: 4, description: 'Consecutive UTC-day completion streak.' })
  currentStreak!: number;

  @ApiProperty({ example: 12, description: 'Best streak ever reached.' })
  longestStreak!: number;
}

/** A synthetic "pack" of the user's saved missions grouped by shared tags. */
export class SavedPackDto {
  @ApiProperty({
    example: 'Outdoors Solo pack',
    description: 'Display name derived from the shared tags.',
  })
  name!: string;

  @ApiProperty({ example: 3, description: 'Number of saved missions in this group.' })
  missionCount!: number;
}

/** Everything the mobile Home screen needs in a single aggregated response. */
export class HomeResponseDto {
  @ApiProperty({ type: LevelDto })
  level!: LevelDto;

  @ApiProperty({ type: StreakDto })
  streak!: StreakDto;

  @ApiProperty({
    type: MissionResponseDto,
    nullable: true,
    description:
      'Deterministic per-UTC-day "today\'s pick", or null when no active missions exist. ' +
      'Cosmetic only — it does not gate mission generation.',
  })
  dailyMission!: MissionResponseDto | null;

  @ApiProperty({
    type: [Object],
    example: [],
    description:
      'Always empty in v1 — a deliberate placeholder until a challenge backend exists, not a bug.',
  })
  pendingChallenges!: unknown[];

  @ApiProperty({
    type: [SavedPackDto],
    description: 'Saved-mission packs ordered by missionCount descending.',
  })
  savedPacks!: SavedPackDto[];
}
