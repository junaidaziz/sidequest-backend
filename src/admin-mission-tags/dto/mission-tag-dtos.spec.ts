import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateMissionTagDto } from './create-mission-tag.dto';
import { ListMissionTagsQueryDto } from './list-mission-tags-query.dto';
import { UpdateMissionTagDto } from './update-mission-tag.dto';

describe('Mission tag DTO validation', () => {
  describe('CreateMissionTagDto', () => {
    it('accepts a well-formed crew tag', () => {
      const dto = plainToInstance(CreateMissionTagDto, {
        type: 'Crew',
        value: 'Solo',
        label: 'Solo',
        sortOrder: 3,
      });
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('rejects an out-of-vocab type', () => {
      const dto = plainToInstance(CreateMissionTagDto, { type: 'Nope', value: 'x', label: 'x' });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('rejects an empty value / label', () => {
      const dto = plainToInstance(CreateMissionTagDto, { type: 'Crew', value: '', label: '' });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('rejects a negative sortOrder', () => {
      const dto = plainToInstance(CreateMissionTagDto, {
        type: 'Setting',
        value: 'Indoors',
        label: 'Indoors',
        sortOrder: -1,
      });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });
  });

  describe('UpdateMissionTagDto', () => {
    it('accepts a partial update', () => {
      const dto = plainToInstance(UpdateMissionTagDto, { label: 'New', isActive: false });
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('accepts an empty object (no-op update)', () => {
      expect(validateSync(plainToInstance(UpdateMissionTagDto, {}))).toHaveLength(0);
    });
  });

  describe('ListMissionTagsQueryDto includeInactive coercion', () => {
    it('coerces "true" and "false" strings to booleans', () => {
      const yes = plainToInstance(ListMissionTagsQueryDto, { includeInactive: 'true' });
      expect(yes.includeInactive).toBe(true);
      expect(validateSync(yes)).toHaveLength(0);

      const no = plainToInstance(ListMissionTagsQueryDto, { includeInactive: 'false' });
      expect(no.includeInactive).toBe(false);
      expect(validateSync(no)).toHaveLength(0);
    });

    it('leaves a non true/false value as-is, which then fails IsBoolean', () => {
      const bad = plainToInstance(ListMissionTagsQueryDto, { includeInactive: 'maybe' });
      expect(validateSync(bad).length).toBeGreaterThan(0);
    });

    it('accepts a valid type filter', () => {
      const dto = plainToInstance(ListMissionTagsQueryDto, { type: 'Setting' });
      expect(validateSync(dto)).toHaveLength(0);
    });
  });
});
