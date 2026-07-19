import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateMissionDto } from './create-mission.dto';
import { ListMissionsQueryDto } from './list-missions-query.dto';
import { MissionActionDto } from './mission-action.dto';
import { MissionMilestoneDto } from './mission-milestone.dto';
import { UpdateMissionDto } from './update-mission.dto';

/** Runs the same transform + validate pipeline the global ValidationPipe applies. */
function build<T extends object>(cls: new () => T, payload: Record<string, unknown>): T {
  return plainToInstance(cls, payload, { enableImplicitConversion: false });
}

describe('CreateMissionDto', () => {
  const base: Record<string, unknown> = {
    title: 'A valid title',
    category: 'explore',
    description: 'desc',
    fullBrief: 'brief',
    proofRequirement: 'proof',
    estimatedMinutes: 20,
    xpReward: 30,
    difficulty: 'Medium',
    difficultyDots: 2,
    crewTags: ['Solo', 'Partner'],
    settingTags: ['Indoors', 'Nature'],
    costTier: 1,
  };

  it('accepts a well-formed payload', () => {
    expect(validateSync(build(CreateMissionDto, base))).toHaveLength(0);
  });

  it('accepts optional authoring fields including nested milestones', () => {
    const errors = validateSync(
      build(CreateMissionDto, {
        ...base,
        sponsorName: 'Acme',
        startDate: '2026-08-01T00:00:00.000Z',
        milestones: [{ title: 'step 1', description: 'do it', order: 0 }],
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a crew tag outside the generator vocab', () => {
    const errors = validateSync(build(CreateMissionDto, { ...base, crewTags: ['Coworkers'] }));
    expect(errors.some((e) => e.property === 'crewTags')).toBe(true);
  });

  it("rejects the 'Anywhere' setting (a query-only wildcard, not an authorable tag)", () => {
    const errors = validateSync(build(CreateMissionDto, { ...base, settingTags: ['Anywhere'] }));
    expect(errors.some((e) => e.property === 'settingTags')).toBe(true);
  });

  it('rejects empty tag arrays', () => {
    const errors = validateSync(build(CreateMissionDto, { ...base, crewTags: [] }));
    expect(errors.some((e) => e.property === 'crewTags')).toBe(true);
  });

  it('rejects an out-of-range difficultyDots', () => {
    const errors = validateSync(build(CreateMissionDto, { ...base, difficultyDots: 9 }));
    expect(errors.some((e) => e.property === 'difficultyDots')).toBe(true);
  });

  it('rejects a malformed nested milestone', () => {
    const errors = validateSync(build(CreateMissionDto, { ...base, milestones: [{ title: '' }] }));
    expect(errors.some((e) => e.property === 'milestones')).toBe(true);
  });
});

describe('UpdateMissionDto', () => {
  it('accepts an empty partial update', () => {
    expect(validateSync(build(UpdateMissionDto, {}))).toHaveLength(0);
  });

  it('still enforces the tag vocab on the partial', () => {
    const errors = validateSync(build(UpdateMissionDto, { settingTags: ['Anywhere'] }));
    expect(errors.some((e) => e.property === 'settingTags')).toBe(true);
  });
});

describe('MissionActionDto', () => {
  it('accepts an empty body', () => {
    expect(validateSync(build(MissionActionDto, {}))).toHaveLength(0);
  });

  it('accepts a reason', () => {
    expect(validateSync(build(MissionActionDto, { reason: 'because' }))).toHaveLength(0);
  });

  it('rejects an over-long reason', () => {
    expect(
      validateSync(build(MissionActionDto, { reason: 'x'.repeat(501) })).length,
    ).toBeGreaterThan(0);
  });
});

describe('MissionMilestoneDto', () => {
  it('requires a title', () => {
    expect(validateSync(build(MissionMilestoneDto, { description: 'x' })).length).toBeGreaterThan(
      0,
    );
  });
});

describe('ListMissionsQueryDto', () => {
  it('coerces string booleans and numeric strings', () => {
    const dto = build(ListMissionsQueryDto, {
      page: '2',
      pageSize: '10',
      featured: 'true',
      isActive: 'false',
    });
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(10);
    expect(dto.featured).toBe(true);
    expect(dto.isActive).toBe(false);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('applies defaults when page/pageSize are absent', () => {
    const dto = build(ListMissionsQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(25);
  });

  it('leaves a non-boolean encoding for the validator to reject', () => {
    const dto = build(ListMissionsQueryDto, { featured: 'maybe' });
    expect(validateSync(dto).some((e) => e.property === 'featured')).toBe(true);
  });

  it('rejects an unknown status enum value', () => {
    const dto = build(ListMissionsQueryDto, { status: 'Nope' });
    expect(validateSync(dto).some((e) => e.property === 'status')).toBe(true);
  });
});
