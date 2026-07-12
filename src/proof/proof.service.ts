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

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isGuest: true,
        currentStreak: true,
        longestStreak: true,
        lastCompletionDate: true,
      },
    });
    if (!user) {
      // Defensive: JwtStrategy already rejects tokens for deleted users.
      throw new NotFoundException('User not found');
    }

    // Guest gate: one free completion, ever. Signed-in users are unlimited in v1.
    if (user.isGuest) {
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

    const streak = computeStreak({
      now: new Date(),
      lastCompletionDate: user.lastCompletionDate,
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
    });

    // Financial-ledger-style write: the Completion and the XP/streak mutation
    // must commit together or not at all.
    const [completion, updatedUser] = await this.prisma.$transaction([
      this.prisma.completion.create({
        data: {
          userId,
          missionId,
          proofType,
          proofKey,
          proofText,
          xpAwarded: mission.xpReward,
        },
        select: { id: true, xpAwarded: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          totalXp: { increment: mission.xpReward },
          currentStreak: streak.currentStreak,
          longestStreak: streak.longestStreak,
          lastCompletionDate: streak.lastCompletionDate,
        },
        select: { totalXp: true, currentStreak: true, longestStreak: true },
      }),
    ]);

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
