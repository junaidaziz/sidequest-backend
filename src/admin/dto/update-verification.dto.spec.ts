import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VerificationStatus } from '@prisma/client';
import { UpdateVerificationDto } from './update-verification.dto';

function validate(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(UpdateVerificationDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('UpdateVerificationDto', () => {
  it('accepts Approved without a rejectionReason', () => {
    expect(validate({ status: VerificationStatus.Approved })).toHaveLength(0);
  });

  it('accepts Rejected with a rejectionReason', () => {
    expect(
      validate({ status: VerificationStatus.Rejected, rejectionReason: 'Blurry' }),
    ).toHaveLength(0);
  });

  it('rejects Rejected with no rejectionReason', () => {
    const errors = validate({ status: VerificationStatus.Rejected });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('rejectionReason');
  });

  it('rejects Rejected with an empty rejectionReason', () => {
    const errors = validate({ status: VerificationStatus.Rejected, rejectionReason: '' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid status value', () => {
    const errors = validate({ status: 'Pending' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });

  it('does not require rejectionReason for Approved even if one is omitted', () => {
    // ValidateIf short-circuits reason validation when approving.
    expect(validate({ status: VerificationStatus.Approved })).toHaveLength(0);
  });
});
