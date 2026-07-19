import { validate } from 'class-validator';
import { IsAdminPassword, meetsAdminPasswordPolicy } from './admin-password.validator';

class Sample {
  @IsAdminPassword()
  password!: string;
}

describe('admin-password.validator', () => {
  describe('meetsAdminPasswordPolicy', () => {
    it('accepts 12+ chars with 3 of 4 classes', () => {
      expect(meetsAdminPasswordPolicy('Abcdefghij12')).toBe(true); // upper+lower+digit
    });

    it('rejects a too-short password', () => {
      expect(meetsAdminPasswordPolicy('Ab1!')).toBe(false);
    });

    it('rejects when fewer than 3 classes are present', () => {
      expect(meetsAdminPasswordPolicy('abcdefghijkl')).toBe(false); // lowercase only
      expect(meetsAdminPasswordPolicy('abcdefghij12')).toBe(false); // 2 classes
    });

    it('rejects a non-string', () => {
      expect(meetsAdminPasswordPolicy(12345678901234 as unknown)).toBe(false);
    });

    it('accepts all four classes', () => {
      expect(meetsAdminPasswordPolicy('Abcdefgh12!@')).toBe(true);
    });
  });

  describe('IsAdminPassword decorator', () => {
    it('passes validation for a compliant value', async () => {
      const sample = new Sample();
      sample.password = 'Abcdefgh12!@';
      expect(await validate(sample)).toHaveLength(0);
    });

    it('fails validation with a descriptive message', async () => {
      const sample = new Sample();
      sample.password = 'weak';
      const errors = await validate(sample);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints?.isAdminPassword).toContain('at least 12 characters');
    });
  });
});
