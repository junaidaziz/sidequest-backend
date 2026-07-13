import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ProofType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { VerificationQueueService } from '../verification/verification-queue.service';
import { ProofResponseDto } from './dto/proof-response.dto';
import { computeStreak } from './streak.util';

/** Machine-readable reason the mobile client keys off to show the signup gate. */
const GUEST_LIMIT_REASON = 'GUEST_COMPLETION_LIMIT_REACHED';

@Injectable()
export class ProofService {
  private readonly logger = new Logger(ProofService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly verificationQueue: VerificationQueueService,
  ) {}

  /**
   * Records a mission completion from a photo or text proof, then awards XP and
   * updates the streak atomically. Exactly one of `photo`/`caption` must be set.
   */
  async submitProof(
    userId: string,
    missionId: string,
    photo?: Express.Multer.File,
    caption?: string,
  ): Promise<ProofResponseDto> {
    const hasPhoto = photo !== undefined && photo !== null;
    const hasCaption = caption !== undefined && caption !== null && caption.length > 0;
    // XOR: reject both-supplied and neither-supplied with the same 400.
    if (hasPhoto === hasCaption) {
      throw new BadRequestException('Provide exactly one of: a photo file or a caption');
    }

    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      select: { id: true, title: true, isActive: true, deletedAt: true, xpReward: true },
    });
    if (!mission || !mission.isActive || mission.deletedAt) {
      throw new NotFoundException('Mission not found or inactive');
    }

    const precheckUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isGuest: true },
    });
    if (!precheckUser) {
      // Defensive: JwtStrategy already rejects tokens for deleted users.
      throw new NotFoundException('User not found');
    }

    // Fast-path guest-gate check, before spending an S3 upload on a request
    // that's obviously already over the limit. NOT the security boundary —
    // see the FOR UPDATE-locked re-check inside the transaction below, which
    // closes the race two concurrent requests would otherwise slip through
    // (both reading count=0 here before either has committed a Completion).
    if (precheckUser.isGuest) {
      const priorCompletions = await this.prisma.completion.count({ where: { userId } });
      if (priorCompletions >= 1) {
        throw new ForbiddenException(GUEST_LIMIT_REASON);
      }
    }

    let proofKey: string | null = null;
    let proofText: string | null = null;
    let proofType: ProofType;

    if (hasPhoto) {
      // buildProofKey rejects unsupported MIME types with a 400.
      proofKey = this.storage.buildProofKey(userId, photo.mimetype);
      await this.storage.uploadObject(proofKey, photo.buffer, photo.mimetype);
      proofType = ProofType.photo;
    } else {
      proofText = caption as string;
      proofType = ProofType.text;
    }

    // Authoritative gate + ledger write, inside one transaction. `FOR UPDATE`
    // locks the user row so a concurrent request from the same guest blocks
    // here until this transaction commits (then re-reads the now-current
    // completion count) — closing the race the fast-path check above cannot
    // close by itself. Re-reading streak fields under the same lock also
    // makes concurrent completions from the *same signed-in user* safe,
    // which the old array-form $transaction did not guarantee either.
    const { completion, updatedUser } = await this.prisma.$transaction(async (tx) => {
      const [lockedUser] = await tx.$queryRaw<
        {
          id: string;
          isGuest: boolean;
          currentStreak: number;
          longestStreak: number;
          lastCompletionDate: Date | null;
        }[]
      >`SELECT id, "isGuest", "currentStreak", "longestStreak", "lastCompletionDate"
        FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!lockedUser) {
        throw new NotFoundException('User not found');
      }
      if (lockedUser.isGuest) {
        const priorCompletions = await tx.completion.count({ where: { userId } });
        if (priorCompletions >= 1) {
          throw new ForbiddenException(GUEST_LIMIT_REASON);
        }
      }

      const streak = computeStreak({
        now: new Date(),
        lastCompletionDate: lockedUser.lastCompletionDate,
        currentStreak: lockedUser.currentStreak,
        longestStreak: lockedUser.longestStreak,
      });

      const createdCompletion = await tx.completion.create({
        data: {
          userId,
          missionId,
          proofType,
          proofKey,
          proofText,
          xpAwarded: mission.xpReward,
        },
        select: { id: true, xpAwarded: true },
      });
      const newUserState = await tx.user.update({
        where: { id: userId },
        data: {
          totalXp: { increment: mission.xpReward },
          currentStreak: streak.currentStreak,
          longestStreak: streak.longestStreak,
          lastCompletionDate: streak.lastCompletionDate,
        },
        select: { totalXp: true, currentStreak: true, longestStreak: true },
      });

      return { completion: createdCompletion, updatedUser: newUserState };
    });

    // Schedule the delayed auto-approval now that the completion is committed.
    // Best-effort side effect: a queue outage must not fail an already-recorded
    // completion (XP is already awarded), so a failure is logged, not thrown —
    // the completion simply stays Pending until an admin resolves it.
    try {
      await this.verificationQueue.enqueueAutoApprove(completion.id);
    } catch (error) {
      this.logger.error(
        `Failed to enqueue auto-approval for completion ${completion.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    const proofUrl =
      proofType === ProofType.photo && proofKey
        ? await this.storage.getSignedDownloadUrl(proofKey)
        : null;

    this.logger.log(
      `Completion ${completion.id} recorded for user ${userId} on mission ${missionId} ` +
        `(+${mission.xpReward} XP, streak ${updatedUser.currentStreak})`,
    );

    return {
      completionId: completion.id,
      missionTitle: mission.title,
      xpAwarded: completion.xpAwarded,
      totalXp: updatedUser.totalXp,
      currentStreak: updatedUser.currentStreak,
      longestStreak: updatedUser.longestStreak,
      proofUrl,
    };
  }
}
