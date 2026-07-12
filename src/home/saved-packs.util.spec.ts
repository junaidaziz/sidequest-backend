import { buildSavedPacks, PackTags } from './saved-packs.util';

describe('buildSavedPacks', () => {
  it('returns an empty array when the user has no saved missions', () => {
    expect(buildSavedPacks([])).toEqual([]);
  });

  it('names a pack from the first setting tag and first crew tag', () => {
    const missions: PackTags[] = [
      { settingTags: ['Outdoors', 'City'], crewTags: ['Solo', 'Partner'] },
    ];
    expect(buildSavedPacks(missions)).toEqual([{ name: 'Outdoors Solo pack', missionCount: 1 }]);
  });

  it('groups missions sharing the same first setting+crew tags and counts them', () => {
    const missions: PackTags[] = [
      { settingTags: ['Outdoors'], crewTags: ['Solo'] },
      { settingTags: ['Outdoors', 'Nature'], crewTags: ['Solo', 'Friends'] },
    ];
    expect(buildSavedPacks(missions)).toEqual([{ name: 'Outdoors Solo pack', missionCount: 2 }]);
  });

  it('groups missions with empty tag arrays under the General fallback', () => {
    const missions: PackTags[] = [
      { settingTags: [], crewTags: [] },
      { settingTags: [], crewTags: [] },
    ];
    expect(buildSavedPacks(missions)).toEqual([{ name: 'General General pack', missionCount: 2 }]);
  });

  it('falls back per-dimension when only one tag array is empty', () => {
    const missions: PackTags[] = [{ settingTags: ['Indoors'], crewTags: [] }];
    expect(buildSavedPacks(missions)).toEqual([{ name: 'Indoors General pack', missionCount: 1 }]);
  });

  it('orders packs by missionCount descending', () => {
    const missions: PackTags[] = [
      { settingTags: ['Outdoors'], crewTags: ['Solo'] },
      { settingTags: ['Indoors'], crewTags: ['Family'] },
      { settingTags: ['Indoors'], crewTags: ['Family'] },
    ];
    expect(buildSavedPacks(missions)).toEqual([
      { name: 'Indoors Family pack', missionCount: 2 },
      { name: 'Outdoors Solo pack', missionCount: 1 },
    ]);
  });

  it('breaks missionCount ties by name for stable output', () => {
    const missions: PackTags[] = [
      { settingTags: ['Outdoors'], crewTags: ['Solo'] },
      { settingTags: ['Indoors'], crewTags: ['Family'] },
    ];
    expect(buildSavedPacks(missions)).toEqual([
      { name: 'Indoors Family pack', missionCount: 1 },
      { name: 'Outdoors Solo pack', missionCount: 1 },
    ]);
  });
});
