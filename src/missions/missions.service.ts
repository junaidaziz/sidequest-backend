import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Mission } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetValue, GenerateMissionsDto, TimeValue } from './dto/generate-missions.dto';
import { GenerateMissionsResponseDto } from './dto/mission-response.dto';
import { SaveMissionResponseDto } from './dto/save-mission-response.dto';
import { toMissionResponse } from './mission-response.mapper';

/** Max mission length (in minutes) a given time budget is willing to see. */
const TIME_CEILINGS: Record<TimeValue, number> = {
  '15 min': 15,
  '30 min': 30,
  '1 hour': 60,
  '2+ hours': 999,
};

/** Highest mission costTier (0=Free … 3=No limit) a given budget accepts. */
const BUDGET_TIERS: Record<BudgetValue, number> = {
  Free: 0,
  'Under $10': 1,
  'Under $30': 2,
  'No limit': 3,
};

/** How many missions a single generate call returns at most. */
const RESULT_SIZE = 3;

@Injectable()
export class MissionsService {
  private readonly logger = new Logger(MissionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns up to 3 random active missions matching the onboarding context.
   *
   * The DB query narrows to the always-eligible set (active, not soft-deleted);
   * the four context rules (time/budget ceilings, crew, setting) are applied
   * in-memory over that small curated pool so each rule is independently
   * testable and the "Anywhere" setting short-circuit stays readable. Selection
   * is a stateless random sample — the mobile "shuffle" button just calls this
   * again and expects a fresh-feeling result, with no exclusion/pagination state.
   */
  async generate(dto: GenerateMissionsDto): Promise<GenerateMissionsResponseDto> {
    const maxMinutes = TIME_CEILINGS[dto.time];
    const maxCostTier = BUDGET_TIERS[dto.budget];

    const active = await this.prisma.mission.findMany({
      where: { isActive: true, deletedAt: null },
    });

    const qualifying = active.filter((mission) =>
      this.matches(mission, dto, maxMinutes, maxCostTier),
    );
    const selected = this.sample(qualifying, RESULT_SIZE);

    this.logger.log(
      `generate(crew=${dto.crew}, time=${dto.time}, setting=${dto.setting}, budget=${dto.budget}) ` +
        `→ ${qualifying.length} qualifying, returned ${selected.length}`,
    );

    return { missions: selected.map((mission) => toMissionResponse(mission)) };
  }

  /**
   * Idempotently marks a mission saved for the current user. A repeat call is a
   * no-op (the `(userId, missionId)` unique constraint means `upsert` never
   * creates a duplicate and never throws a conflict) — the endpoint just
   * confirms the resulting state. 404s if the mission is missing or inactive so
   * the client cannot bookmark a quest it can never see again.
   */
  async saveMission(userId: string, missionId: string): Promise<SaveMissionResponseDto> {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      select: { id: true, isActive: true, deletedAt: true },
    });
    if (!mission || !mission.isActive || mission.deletedAt) {
      throw new NotFoundException('Mission not found or inactive');
    }

    await this.prisma.savedMission.upsert({
      where: { userId_missionId: { userId, missionId } },
      create: { userId, missionId },
      update: {},
    });

    this.logger.log(`Mission ${missionId} saved for user ${userId}`);
    return { saved: true };
  }

  /**
   * Idempotently ensures the mission is not saved for the current user.
   * `deleteMany` removes the row if present and quietly matches zero rows if
   * not — deleting a non-existent save is not an error, and no mission-existence
   * check is needed to un-bookmark.
   */
  async unsaveMission(userId: string, missionId: string): Promise<SaveMissionResponseDto> {
    await this.prisma.savedMission.deleteMany({ where: { userId, missionId } });

    this.logger.log(`Mission ${missionId} unsaved for user ${userId}`);
    return { saved: false };
  }

  /** True when a mission satisfies all four context rules simultaneously. */
  private matches(
    mission: Mission,
    dto: GenerateMissionsDto,
    maxMinutes: number,
    maxCostTier: number,
  ): boolean {
    const withinTime = mission.estimatedMinutes <= maxMinutes;
    const withinBudget = mission.costTier <= maxCostTier;
    const crewMatches = mission.crewTags.includes(dto.crew);
    const settingMatches = dto.setting === 'Anywhere' || mission.settingTags.includes(dto.setting);

    return withinTime && withinBudget && crewMatches && settingMatches;
  }

  /**
   * Fisher-Yates partial shuffle: returns up to `count` distinct random items
   * without mutating the input. Fewer than `count` in → all of them, shuffled.
   */
  private sample<T>(pool: T[], count: number): T[] {
    const copy = [...pool];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
  }
}
