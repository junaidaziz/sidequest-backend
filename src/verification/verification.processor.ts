import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutoApproveJobData, VERIFICATION_QUEUE } from './verification.constants';

/** Identity written to Completion.verifiedBy when the timeout job approves. */
const AUTO_VERIFIER = 'auto';

interface LockedCompletionRow {
  id: string;
  verificationStatus: VerificationStatus;
}

/**
 * Consumes the delayed auto-approve job. Re-reads the completion's current
 * status under a `SELECT ... FOR UPDATE` row lock (same concurrency pattern as
 * ProofService's guest-limit re-check) so a manual admin override that lands
 * between the timer firing and this transaction committing always wins: if the
 * row is no longer Pending we no-op. XP is deliberately NOT touched here — it
 * was already awarded optimistically at submission time and is only ever
 * reversed on an explicit rejection.
 */
@Processor(VERIFICATION_QUEUE)
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AutoApproveJobData>): Promise<void> {
    const { completionId } = job.data;

    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<LockedCompletionRow[]>`
        SELECT id, "verificationStatus"
        FROM completions
        WHERE id = ${completionId}
        FOR UPDATE`;

      if (!row) {
        // Completion was hard-deleted between scheduling and firing; nothing to do.
        this.logger.warn(`Auto-approve skipped: completion ${completionId} no longer exists`);
        return;
      }

      if (row.verificationStatus !== VerificationStatus.Pending) {
        // A manual admin override (Approved or Rejected) beat the timer.
        this.logger.log(
          `Auto-approve skipped: completion ${completionId} already resolved ` +
            `(${row.verificationStatus})`,
        );
        return;
      }

      await tx.completion.update({
        where: { id: completionId },
        data: {
          verificationStatus: VerificationStatus.Approved,
          verifiedAt: new Date(),
          verifiedBy: AUTO_VERIFIER,
        },
      });

      this.logger.log(`Auto-approved completion ${completionId}`);
    });
  }
}
