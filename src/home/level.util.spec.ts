import { computeLevel } from './level.util';

describe('computeLevel', () => {
  it('maps totalXp=0 to level 1, 0 into level, 100 to next', () => {
    expect(computeLevel(0)).toEqual({
      level: 1,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      totalXp: 0,
    });
  });

  it('maps totalXp=250 to level 3, 50 into level, 50 to next', () => {
    expect(computeLevel(250)).toEqual({
      level: 3,
      xpIntoLevel: 50,
      xpToNextLevel: 50,
      totalXp: 250,
    });
  });

  it('treats an exact level boundary (100) as the start of the next level', () => {
    expect(computeLevel(100)).toEqual({
      level: 2,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      totalXp: 100,
    });
  });

  it('handles a value just below a boundary (99) as still level 1 with 1 to next', () => {
    expect(computeLevel(99)).toEqual({
      level: 1,
      xpIntoLevel: 99,
      xpToNextLevel: 1,
      totalXp: 99,
    });
  });
});
