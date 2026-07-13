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

/**
 * Aggregate proof-verification counters for the Home screen's "your progress"
 * strip. Derived from the user's Completion rows grouped by verificationStatus,
 * so the four buckets always sum to `total` (every row has exactly one status).
 */
export class TaskStatsDto {
  @ApiProperty({
    example: 10,
    description:
      'Every Completion row this user owns, regardless of status — the denominator ' +
      'for completionRate and the sum of approved + pending + rejected.',
  })
  total!: number;

  @ApiProperty({
    example: 6,
    description:
      'Completions whose verificationStatus is Approved — the only ones that count as ' +
      'genuinely "done" for the completion rate.',
  })
  approved!: number;

  @ApiProperty({
    example: 3,
    description:
      'Completions still Pending review (auto-approved later by the timeout job unless ' +
      'an admin acts first) — surfaced so the user sees work that has not settled yet.',
  })
  pending!: number;

  @ApiProperty({
    example: 1,
    description: 'Completions an admin (or the timeout path) marked Rejected.',
  })
  rejected!: number;

  @ApiProperty({
    example: 0.6,
    description:
      'approved / total as a 0-1 fraction. Deliberately 0 (never NaN) when total is 0, ' +
      'so a brand-new user with no completions renders a clean 0% instead of a broken value.',
  })
  completionRate!: number;
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

  @ApiProperty({
    type: TaskStatsDto,
    description:
      'Proof-verification tallies (total/approved/pending/rejected + completion rate) ' +
      'for this user across all their completions.',
  })
  taskStats!: TaskStatsDto;
}
