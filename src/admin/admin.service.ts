import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateVerificationDto } from './dto/update-verification.dto';
import { VerificationResponseDto } from './dto/verification-response.dto';

/** Identity written to Completion.verifiedBy for a manual admin override. */
const ADMIN_VERIFIER = 'admin';

interface LockedCompletionRow {
  id: string;
  userId: string;
  xpAwarded: number;
  verificationStatus: VerificationStatus;
}

/**
 * Applies a manual admin verification decision to a completion. Uses the same
 * `SELECT ... FOR UPDATE` row-lock pattern as ProofService/VerificationProcessor
 * so a decision and the auto-approve timer can never both apply to the same
 * row: whichever acquires the lock first resolves it, and the loser observes a
 * non-Pending status and is rejected with a 409.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async updateVerification(
    completionId: string,
    dto: UpdateVerificationDto,
  ): Promise<VerificationResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<LockedCompletionRow[]>`
        SELECT id, "userId", "xpAwarded", "verificationStatus"
        FROM completions
        WHERE id = ${completionId}
        FOR UPDATE`;

      if (!row) {
        throw new NotFoundException('Completion not found');
      }

      if (row.verificationStatus !== VerificationStatus.Pending) {
        // Already resolved by the auto-approve job or a prior manual call —
        // refuse to double-apply rather than silently overwriting.
        throw new ConflictException(
          `Completion is already ${row.verificationStatus} and cannot be changed`,
        );
      }

      const verifiedAt = new Date();
      const isRejection = dto.status === VerificationStatus.Rejected;

      const updated = await tx.completion.update({
        where: { id: completionId },
        data: {
          verificationStatus: dto.status,
          verifiedAt,
          verifiedBy: ADMIN_VERIFIER,
          // rejectionReason is only meaningful on rejection; the DTO ignores any
          // value supplied alongside an Approved status.
          rejectionReason: isRejection ? (dto.rejectionReason ?? null) : null,
        },
        select: {
          id: true,
          verificationStatus: true,
          verifiedAt: true,
          verifiedBy: true,
          rejectionReason: true,
        },
      });

      if (isRejection) {
        // Reverse the optimistically-awarded XP, clamped at 0 so a user can
        // never go negative. currentStreak/longestStreak are deliberately NOT
        // reversed: accurately unwinding streak state would require replaying
        // the user's full completion history (a rejected completion could sit
        // anywhere in a chain), which is out of scope for this v1 milestone.
        //
        // Atomic SQL decrement, not a read-modify-write: a plain
        // findUnique-then-update here would race a concurrent ProofService
        // submission incrementing the same user's totalXp between the read and
        // the write (READ COMMITTED doesn't lock the users row on a plain
        // SELECT), silently discarding the concurrent grant. GREATEST(...) does
        // the clamp-at-0 in the same statement as the decrement.
        await tx.$executeRaw`
          UPDATE users
          SET "totalXp" = GREATEST(0, "totalXp" - ${row.xpAwarded})
          WHERE id = ${row.userId}`;
        this.logger.log(
          `Completion ${completionId} rejected by admin; reversed ${row.xpAwarded} XP ` +
            `for user ${row.userId}`,
        );
      } else {
        this.logger.log(`Completion ${completionId} approved by admin`);
      }

      return {
        completionId: updated.id,
        verificationStatus: updated.verificationStatus,
        verifiedAt: updated.verifiedAt,
        verifiedBy: updated.verifiedBy,
        rejectionReason: updated.rejectionReason,
      };
    });
  }
}
