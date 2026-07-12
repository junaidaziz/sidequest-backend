import { Mission } from '@prisma/client';
import { MissionResponseDto } from './dto/mission-response.dto';

/**
 * Single source of truth for the DB-column -> mobile-short-field mapping
 * (description->desc, fullBrief->full, proofRequirement->proof, estimatedMinutes
 * formatted as "<N> min", xpReward formatted as "+<N> XP", difficulty->diff,
 * difficultyDots->dots). Extracted as a pure function so both the mission
 * generator and the Home screen's daily-mission card map identically — the
 * short field names must never drift apart between the two call sites.
 */
export function toMissionResponse(mission: Mission): MissionResponseDto {
  return {
    id: mission.id,
    category: mission.category,
    title: mission.title,
    desc: mission.description,
    full: mission.fullBrief,
    proof: mission.proofRequirement,
    time: `${mission.estimatedMinutes} min`,
    xp: `+${mission.xpReward} XP`,
    diff: mission.difficulty,
    dots: mission.difficultyDots,
  };
}
