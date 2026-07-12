import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GenerateMissionsDto } from './generate-missions.dto';

/** Runs the DTO's class-validator decorators and returns the erroring fields. */
function invalidFields(payload: Record<string, unknown>): string[] {
  const dto = plainToInstance(GenerateMissionsDto, payload);
  return validateSync(dto).map((error) => error.property);
}

const VALID = {
  crew: 'Solo',
  time: '30 min',
  setting: 'Outdoors',
  budget: 'Free',
};

describe('GenerateMissionsDto', () => {
  it('accepts a body where every field is in its allowed set', () => {
    expect(invalidFields(VALID)).toEqual([]);
  });

  it('accepts the "Anywhere" setting and the "No limit" budget edge values', () => {
    expect(invalidFields({ ...VALID, setting: 'Anywhere', budget: 'No limit' })).toEqual([]);
  });

  it.each([
    ['crew', { ...VALID, crew: 'Coworkers' }],
    ['time', { ...VALID, time: '45 min' }],
    ['setting', { ...VALID, setting: 'Underwater' }],
    ['budget', { ...VALID, budget: 'Expensive' }],
  ])('rejects an out-of-set %s value', (field, payload) => {
    expect(invalidFields(payload)).toContain(field);
  });

  it('rejects a body missing every field', () => {
    expect(invalidFields({}).sort()).toEqual(['budget', 'crew', 'setting', 'time']);
  });
});
