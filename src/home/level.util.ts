/**
 * XP required to advance one level. Flat curve: every level costs the same
 * 100 XP. Level is derived from User.totalXp at read time (never stored — see
 * schema.prisma) so this curve can change without a migration.
 */
export const XP_PER_LEVEL = 100;

/** Derived level progression for the Home screen's XP ring. */
export interface LevelProgress {
  /** 1-based level: floor(totalXp / 100) + 1. */
  level: number;
  /** XP accumulated within the current level: totalXp % 100. */
  xpIntoLevel: number;
  /** XP still needed to reach the next level: 100 - xpIntoLevel. */
  xpToNextLevel: number;
  /** The raw lifetime XP total this was derived from. */
  totalXp: number;
}

/**
 * Pure derivation of level progress from a flat 100-XP-per-level curve:
 *   totalXp=0   -> level 1, 0 into, 100 to next
 *   totalXp=250 -> level 3, 50 into, 50 to next
 * Side-effect-free so it is unit-tested in isolation from the service.
 */
export function computeLevel(totalXp: number): LevelProgress {
  const xpIntoLevel = totalXp % XP_PER_LEVEL;
  return {
    level: Math.floor(totalXp / XP_PER_LEVEL) + 1,
    xpIntoLevel,
    xpToNextLevel: XP_PER_LEVEL - xpIntoLevel,
    totalXp,
  };
}
