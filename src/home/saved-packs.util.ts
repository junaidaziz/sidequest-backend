/** The tag pair used to group saved missions into a display "pack". */
export interface PackTags {
  settingTags: string[];
  crewTags: string[];
}

/** A synthetic pack surfaced on the Home screen — no Pack entity is persisted. */
export interface SavedPack {
  /** Display name, e.g. "Outdoors Solo pack". */
  name: string;
  /** How many of the user's saved missions fall in this group. */
  missionCount: number;
}

/**
 * Fallback tag used when a mission has an empty settingTags or crewTags array,
 * so every saved mission lands in exactly one group (e.g. "General General pack").
 */
const FALLBACK_TAG = 'General';

/**
 * Groups a user's saved missions into display packs by the synthetic key
 * `${firstSettingTag}|${firstCrewTag}` (each defaulting to "General" when its
 * tag array is empty), names each group `"${setting} ${crew} pack"`, and orders
 * packs by missionCount descending (ties broken by name for stable output).
 * Empty input -> []. Pure and side-effect-free so it is unit-tested in
 * isolation from the service.
 */
export function buildSavedPacks(missions: PackTags[]): SavedPack[] {
  const counts = new Map<string, { name: string; missionCount: number }>();

  for (const mission of missions) {
    const setting = mission.settingTags[0] ?? FALLBACK_TAG;
    const crew = mission.crewTags[0] ?? FALLBACK_TAG;
    const key = `${setting}|${crew}`;
    const existing = counts.get(key);
    if (existing) {
      existing.missionCount += 1;
    } else {
      counts.set(key, { name: `${setting} ${crew} pack`, missionCount: 1 });
    }
  }

  return Array.from(counts.values()).sort(
    (a, b) => b.missionCount - a.missionCount || a.name.localeCompare(b.name),
  );
}
