import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MissionPoolService } from '../missions/mission-pool.service';
import { toMissionResponse } from '../missions/mission-response.mapper';
import { daySeedFromDate, pickDailyMission } from './daily-mission.util';
import { HomeResponseDto, TaskStatsDto } from './dto/home-response.dto';
import { computeLevel } from './level.util';
import { buildSavedPacks } from './saved-packs.util';

/** Shape of each `completion.groupBy({ by: ['verificationStatus'] })` row. */
interface VerificationStatusGroup {
  verificationStatus: VerificationStatus;
  _count: number;
}

/**
 * Reduces the grouped completion counts into the four Home task-stat buckets.
 * completionRate is approved/total, guarded to 0 when total is 0 so a user with
 * no completions never yields NaN.
 */
function buildTaskStats(groups: VerificationStatusGroup[]): TaskStatsDto {
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  for (const group of groups) {
    switch (group.verificationStatus) {
      case VerificationStatus.Approved:
        approved = group._count;
        break;
      case VerificationStatus.Pending:
        pending = group._count;
        break;
      case VerificationStatus.Rejected:
        rejected = group._count;
        break;
    }
  }
  const total = approved + pending + rejected;
  return {
    total,
    approved,
    pending,
    rejected,
    completionRate: total === 0 ? 0 : approved / total,
  };
}

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly missionPool: MissionPoolService,
  ) {}

  /**
   * Aggregates the Home screen payload for both guests and signed-in users in a
   * single response. The three reads are independent, so they run concurrently:
   *   - the User row for level (derived) + streak counters,
   *   - the active mission pool (ordered by id) for the deterministic daily pick,
   *   - the user's saved missions (only the tags needed) for pack grouping,
   *   - the user's completions grouped by verificationStatus (one query, not
   *     three counts) for the task-stats tallies.
   * pendingChallenges is a deliberate empty v1 placeholder — no challenge
   * backend exists yet.
   */
  async getHome(userId: string): Promise<HomeResponseDto> {
    const [user, activeMissions, saved, completionGroups] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { totalXp: true, currentStreak: true, longestStreak: true },
      }),
      this.missionPool.getActivePool(),
      this.prisma.savedMission.findMany({
        where: { userId },
        select: { mission: { select: { settingTags: true, crewTags: true } } },
      }),
      this.prisma.completion.groupBy({
        by: ['verificationStatus'],
        where: { userId },
        _count: true,
      }),
    ]);

    if (!user) {
      // Defensive: JwtStrategy already rejects tokens for deleted users.
      throw new NotFoundException('User not found');
    }

    const daily = pickDailyMission(activeMissions, daySeedFromDate(new Date()));
    const savedPacks = buildSavedPacks(saved.map((row) => row.mission));
    const taskStats = buildTaskStats(completionGroups);

    this.logger.log(
      `home(user=${userId}) -> level ${Math.floor(user.totalXp / 100) + 1}, ` +
        `${savedPacks.length} saved pack(s), daily=${daily ? daily.id : 'none'}`,
    );

    return {
      level: computeLevel(user.totalXp),
      streak: {
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
      },
      dailyMission: daily ? toMissionResponse(daily) : null,
      pendingChallenges: [],
      savedPacks,
      taskStats,
    };
  }
}
