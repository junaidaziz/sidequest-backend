import { ConflictException, NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';
import { UpdateVerificationDto } from './dto/update-verification.dto';

const COMPLETION_ID = '55555555-5555-5555-5555-555555555555';
const USER_ID = '66666666-6666-6666-6666-666666666666';

interface TxMock {
  $queryRaw: jest.Mock;
  completion: { update: jest.Mock };
  user: { findUnique: jest.Mock; update: jest.Mock };
}

function lockedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPLETION_ID,
    userId: USER_ID,
    xpAwarded: 40,
    verificationStatus: VerificationStatus.Pending,
    ...overrides,
  };
}

describe('AdminService', () => {
  let service: AdminService;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      completion: { update: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue(undefined) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: (t: TxMock) => Promise<unknown>) => cb(tx)),
    };
    service = new AdminService(prisma as unknown as PrismaService);
  });

  it('locks the completion row with SELECT ... FOR UPDATE', async () => {
    tx.$queryRaw.mockResolvedValue([lockedRow()]);
    tx.completion.update.mockResolvedValue({
      id: COMPLETION_ID,
      verificationStatus: VerificationStatus.Approved,
      verifiedAt: new Date(),
      verifiedBy: 'admin',
      rejectionReason: null,
    });

    await service.updateVerification(COMPLETION_ID, {
      status: VerificationStatus.Approved,
    } as UpdateVerificationDto);

    const [strings] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join('')).toContain('FOR UPDATE');
  });

  describe('approval', () => {
    it('sets Approved/verifiedBy=admin and does not touch XP', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow()]);
      const verifiedAt = new Date();
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Approved,
        verifiedAt,
        verifiedBy: 'admin',
        rejectionReason: null,
      });

      const result = await service.updateVerification(COMPLETION_ID, {
        status: VerificationStatus.Approved,
      } as UpdateVerificationDto);

      expect(tx.completion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationStatus: VerificationStatus.Approved,
            verifiedBy: 'admin',
            rejectionReason: null,
          }),
        }),
      );
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        completionId: COMPLETION_ID,
        verificationStatus: VerificationStatus.Approved,
        verifiedAt,
        verifiedBy: 'admin',
        rejectionReason: null,
      });
    });
  });

  describe('rejection', () => {
    it('sets Rejected with the reason and decrements the user XP by xpAwarded', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow({ xpAwarded: 40 })]);
      tx.user.findUnique.mockResolvedValue({ totalXp: 100 });
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Rejected,
        verifiedAt: new Date(),
        verifiedBy: 'admin',
        rejectionReason: 'Blurry photo',
      });

      const result = await service.updateVerification(COMPLETION_ID, {
        status: VerificationStatus.Rejected,
        rejectionReason: 'Blurry photo',
      });

      expect(tx.completion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationStatus: VerificationStatus.Rejected,
            rejectionReason: 'Blurry photo',
          }),
        }),
      );
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { totalXp: 60 },
      });
      expect(result.rejectionReason).toBe('Blurry photo');
    });

    it('coerces a missing reason to null (defensive — the DTO normally guarantees one)', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow({ xpAwarded: 10 })]);
      tx.user.findUnique.mockResolvedValue({ totalXp: 100 });
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Rejected,
        verifiedAt: new Date(),
        verifiedBy: 'admin',
        rejectionReason: null,
      });

      await service.updateVerification(COMPLETION_ID, {
        status: VerificationStatus.Rejected,
      } as UpdateVerificationDto);

      expect(tx.completion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rejectionReason: null }),
        }),
      );
    });

    it('clamps the XP decrement at 0 (never negative)', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow({ xpAwarded: 40 })]);
      tx.user.findUnique.mockResolvedValue({ totalXp: 10 });
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Rejected,
        verifiedAt: new Date(),
        verifiedBy: 'admin',
        rejectionReason: 'Invalid',
      });

      await service.updateVerification(COMPLETION_ID, {
        status: VerificationStatus.Rejected,
        rejectionReason: 'Invalid',
      });

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { totalXp: 0 },
      });
    });

    it('treats a missing owner as 0 XP and clamps at 0 (defensive)', async () => {
      tx.$queryRaw.mockResolvedValue([lockedRow({ xpAwarded: 40 })]);
      tx.user.findUnique.mockResolvedValue(null);
      tx.completion.update.mockResolvedValue({
        id: COMPLETION_ID,
        verificationStatus: VerificationStatus.Rejected,
        verifiedAt: new Date(),
        verifiedBy: 'admin',
        rejectionReason: 'Invalid',
      });

      await service.updateVerification(COMPLETION_ID, {
        status: VerificationStatus.Rejected,
        rejectionReason: 'Invalid',
      });

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { totalXp: 0 },
      });
    });
  });

  describe('guards', () => {
    it('throws NotFoundException when the completion does not exist', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.updateVerification(COMPLETION_ID, {
          status: VerificationStatus.Approved,
        } as UpdateVerificationDto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.completion.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the completion is already Approved', async () => {
      tx.$queryRaw.mockResolvedValue([
        lockedRow({ verificationStatus: VerificationStatus.Approved }),
      ]);

      await expect(
        service.updateVerification(COMPLETION_ID, {
          status: VerificationStatus.Rejected,
          rejectionReason: 'too late',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.completion.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the completion is already Rejected', async () => {
      tx.$queryRaw.mockResolvedValue([
        lockedRow({ verificationStatus: VerificationStatus.Rejected }),
      ]);

      await expect(
        service.updateVerification(COMPLETION_ID, {
          status: VerificationStatus.Approved,
        } as UpdateVerificationDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
