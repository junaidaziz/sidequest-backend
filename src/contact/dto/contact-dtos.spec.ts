import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateContactSubmissionDto } from './create-contact-submission.dto';
import { ListContactSubmissionsQueryDto } from './list-contact-submissions-query.dto';
import { UpdateContactSubmissionDto } from './update-contact-submission.dto';

describe('Contact DTO validation', () => {
  describe('CreateContactSubmissionDto', () => {
    it('accepts a well-formed submission and normalizes the email', () => {
      const dto = plainToInstance(CreateContactSubmissionDto, {
        name: 'Ada',
        email: '  ADA@Example.com ',
        topic: 'Hi',
        message: 'Hello there',
      });
      expect(dto.email).toBe('ada@example.com');
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('leaves a non-string email untouched (transform passthrough) and fails validation', () => {
      const dto = plainToInstance(CreateContactSubmissionDto, {
        name: 'Ada',
        email: 12345,
        topic: 'Hi',
        message: 'Hello',
      });
      expect(dto.email).toBe(12345);
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('rejects an empty message', () => {
      const dto = plainToInstance(CreateContactSubmissionDto, {
        name: 'Ada',
        email: 'ada@example.com',
        topic: 'Hi',
        message: '',
      });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });

    it('rejects an over-long message', () => {
      const dto = plainToInstance(CreateContactSubmissionDto, {
        name: 'Ada',
        email: 'ada@example.com',
        topic: 'Hi',
        message: 'x'.repeat(5001),
      });
      expect(validateSync(dto).length).toBeGreaterThan(0);
    });
  });

  describe('UpdateContactSubmissionDto', () => {
    it('accepts a valid status', () => {
      expect(
        validateSync(plainToInstance(UpdateContactSubmissionDto, { status: 'Resolved' })),
      ).toHaveLength(0);
    });

    it('rejects an out-of-vocab status', () => {
      expect(
        validateSync(plainToInstance(UpdateContactSubmissionDto, { status: 'Closed' })).length,
      ).toBeGreaterThan(0);
    });
  });

  describe('ListContactSubmissionsQueryDto', () => {
    it('coerces numeric page/pageSize strings', () => {
      const q = plainToInstance(ListContactSubmissionsQueryDto, { page: '2', pageSize: '10' });
      expect(q.page).toBe(2);
      expect(q.pageSize).toBe(10);
      expect(validateSync(q)).toHaveLength(0);
    });

    it('rejects pageSize above the max', () => {
      const q = plainToInstance(ListContactSubmissionsQueryDto, { pageSize: '500' });
      expect(validateSync(q).length).toBeGreaterThan(0);
    });

    it('accepts a status filter', () => {
      expect(
        validateSync(plainToInstance(ListContactSubmissionsQueryDto, { status: 'New' })),
      ).toHaveLength(0);
    });
  });
});
