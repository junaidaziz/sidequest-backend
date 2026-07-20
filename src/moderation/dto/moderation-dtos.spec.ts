import { VerificationStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateModerationActionDto } from './create-moderation-action.dto';
import { DecideAppealDto } from './decide-appeal.dto';
import { ListModerationActionsQueryDto } from './list-moderation-actions-query.dto';
import { ListReportsQueryDto } from './list-reports-query.dto';
import { ModerationQueueQueryDto } from './moderation-queue-query.dto';
import { ReviewProofDto } from './review-proof.dto';
import { UpdateReportDto } from './update-report.dto';
import { ModerationQueueSource } from '../types/moderation';

/**
 * DTO-level validation coverage: exercises the class-transformer `@Type`
 * coercions and the class-validator rules through the same path the global
 * ValidationPipe uses, so the transforms are covered outside an e2e run.
 */
describe('moderation DTOs', () => {
  describe('ModerationQueueQueryDto', () => {
    it('coerces string page/pageSize to numbers and accepts a source enum', () => {
      const dto = plainToInstance(ModerationQueueQueryDto, {
        page: '2',
        pageSize: '10',
        source: ModerationQueueSource.Completion,
      });
      expect(dto.page).toBe(2);
      expect(dto.pageSize).toBe(10);
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('rejects a pageSize above the maximum and an unknown source', () => {
      expect(
        validateSync(plainToInstance(ModerationQueueQueryDto, { pageSize: '500' })),
      ).not.toHaveLength(0);
      expect(
        validateSync(plainToInstance(ModerationQueueQueryDto, { source: 'nope' })),
      ).not.toHaveLength(0);
    });
  });

  describe('ListReportsQueryDto / ListModerationActionsQueryDto', () => {
    it('accepts valid filters', () => {
      expect(
        validateSync(
          plainToInstance(ListReportsQueryDto, { page: '1', status: 'Open', reason: 'spam' }),
        ),
      ).toHaveLength(0);
      expect(
        validateSync(
          plainToInstance(ListModerationActionsQueryDto, {
            actionType: 'BanUser',
            targetUserId: '22222222-2222-4222-a222-222222222222',
          }),
        ),
      ).toHaveLength(0);
    });

    it('rejects a non-uuid targetUserId', () => {
      expect(
        validateSync(plainToInstance(ListModerationActionsQueryDto, { targetUserId: 'not-uuid' })),
      ).not.toHaveLength(0);
    });
  });

  describe('UpdateReportDto', () => {
    it('accepts a terminal transition and rejects transitioning back to Open', () => {
      expect(validateSync(plainToInstance(UpdateReportDto, { status: 'Resolved' }))).toHaveLength(
        0,
      );
      expect(validateSync(plainToInstance(UpdateReportDto, { status: 'Open' }))).not.toHaveLength(
        0,
      );
    });
  });

  describe('CreateModerationActionDto', () => {
    it('accepts a valid action with an ISO expiry', () => {
      const dto = plainToInstance(CreateModerationActionDto, {
        actionType: 'SuspendUser',
        reason: 'abuse',
        expiresAt: '2026-08-01T00:00:00.000Z',
      });
      expect(validateSync(dto)).toHaveLength(0);
    });

    it('rejects a missing reason and a non-ISO expiry', () => {
      expect(
        validateSync(plainToInstance(CreateModerationActionDto, { actionType: 'WarnUser' })),
      ).not.toHaveLength(0);
      expect(
        validateSync(
          plainToInstance(CreateModerationActionDto, {
            actionType: 'WarnUser',
            reason: 'r',
            expiresAt: 'yesterday',
          }),
        ),
      ).not.toHaveLength(0);
    });
  });

  describe('DecideAppealDto', () => {
    it('accepts Upheld/Denied and rejects Pending', () => {
      expect(validateSync(plainToInstance(DecideAppealDto, { decision: 'Upheld' }))).toHaveLength(
        0,
      );
      expect(
        validateSync(plainToInstance(DecideAppealDto, { decision: 'Pending' })),
      ).not.toHaveLength(0);
    });
  });

  describe('ReviewProofDto', () => {
    it('requires a rejectionReason only when Rejected', () => {
      expect(
        validateSync(plainToInstance(ReviewProofDto, { status: VerificationStatus.Approved })),
      ).toHaveLength(0);
      expect(
        validateSync(plainToInstance(ReviewProofDto, { status: VerificationStatus.Rejected })),
      ).not.toHaveLength(0);
      expect(
        validateSync(
          plainToInstance(ReviewProofDto, {
            status: VerificationStatus.Rejected,
            rejectionReason: 'blurry',
          }),
        ),
      ).toHaveLength(0);
    });
  });
});
