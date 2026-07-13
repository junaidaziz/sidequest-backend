import { VerificationStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationProcessor } from './verification.processor';
import { AutoApproveJobData } from './verification.constants';

const COMPLETION_ID = '44444444-4444-4444-4444-444444444444';

interface TxMock {
  $queryRaw: jest.Mock;
  completion: { update: jest.Mock };
}

function job(): Job<AutoApproveJobData> {
  return { data: { completionId: COMPLETION_ID } } as Job<AutoApproveJobData>;
}

describe('VerificationProcessor', () => {
  let processor: VerificationProcessor;
  let tx: TxMock;
  let prisma: { $transaction: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      completion: { update: jest.fn().mockResolvedValue(undefined) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: (t: TxMock) => Promise<unknown>) => cb(tx)),
    };
    processor = new VerificationProcessor(prisma as unknown as PrismaService);
  });

  it('approves a still-Pending completion, setting verifiedBy=auto', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: COMPLETION_ID, verificationStatus: VerificationStatus.Pending },
    ]);

    await processor.process(job());

    // Row lock taken with FOR UPDATE.
    const [strings] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join('')).toContain('FOR UPDATE');
    expect(tx.completion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMPLETION_ID },
        data: expect.objectContaining({
          verificationStatus: VerificationStatus.Approved,
          verifiedBy: 'auto',
          verifiedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('no-ops when the completion is already Approved (manual override beat the timer)', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: COMPLETION_ID, verificationStatus: VerificationStatus.Approved },
    ]);

    await processor.process(job());

    expect(tx.completion.update).not.toHaveBeenCalled();
  });

  it('no-ops when the completion is already Rejected', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: COMPLETION_ID, verificationStatus: VerificationStatus.Rejected },
    ]);

    await processor.process(job());

    expect(tx.completion.update).not.toHaveBeenCalled();
  });

  it('no-ops when the completion no longer exists', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await processor.process(job());

    expect(tx.completion.update).not.toHaveBeenCalled();
  });
});
