import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toMissionResponse } from '../missions/mission-response.mapper';
import { daySeedFromDate, pickDailyMission } from './daily-mission.util';
import { HomeResponseDto } from './dto/home-response.dto';
import { computeLevel } from './level.util';
import { buildSavedPacks } from './saved-packs.util';

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregates the Home screen payload for both guests and signed-in users in a
   * single response. The three reads are independent, so they run concurrently:
   *   - the User row for level (derived) + streak counters,
   *   - the active mission pool (ordered by id) for the deterministic daily pick,
   *   - the user's saved missions (only the tags needed) for pack grouping.
   * pendingChallenges is a deliberate empty v1 placeholder — no challenge
   * backend exists yet.
   */
  async getHome(userId: string): Promise<HomeResponseDto> {
    const [user, activeMissions, saved] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { totalXp: true, currentStreak: true, longestStreak: true },
      }),
      this.prisma.mission.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: { id: 'asc' },
      }),
      this.prisma.savedMission.findMany({
        where: { userId },
        select: { mission: { select: { settingTags: true, crewTags: true } } },
      }),
    ]);

    if (!user) {
      // Defensive: JwtStrategy already rejects tokens for deleted users.
      throw new NotFoundException('User not found');
    }

    const daily = pickDailyMission(activeMissions, daySeedFromDate(new Date()));
    const savedPacks = buildSavedPacks(saved.map((row) => row.mission));

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
    };
  }
}
