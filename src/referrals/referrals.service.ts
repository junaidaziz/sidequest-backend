import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma, ReferralStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { NotificationsService, NotifyParams } from '../notifications/notifications.service';
import { ReferralMeDto } from './dto/referral-me.dto';
import { RecordInviteDto } from './dto/record-invite.dto';
import { InviteRecordedDto } from './dto/invite-recorded.dto';
import {
  PaginatedReferralHistoryDto,
  ReferralHistoryItemDto,
  ReferralHistoryQueryDto,
} from './dto/referral-history.dto';
import { generateReferralCode } from './referral-code.util';

/** Deep-link scheme the mobile app registers; embedded in a shared invite URL. */
const REFERRAL_INVITE_URL_PREFIX = 'sidequest://referrals/invite/';

/**
 * The only reward trigger active in v1 (Decision 4): a referral qualifies when
 * its referee's first completion is approved. The seed provisions exactly one
 * ReferralRewardRule with this trigger.
 */
export const REFERRAL_COMPLETION_TRIGGER = 'on_referee_first_completion';

/** The single reward currency in v1 (Decision 3) — feeds User.totalXp. */
export const REFERRAL_REWARD_TYPE_XP = 'xp';

/** How many fresh codes to try before giving up on a collision. */
const MAX_CODE_GENERATION_ATTEMPTS = 5;

const DEFAULT_HISTORY_LIMIT = 20;

/** Minimal row shape returned by the `SELECT ... FOR UPDATE` referral lock. */
interface LockedReferralRow {
  id: string;
  status: ReferralStatus;
  referrerId: string;
}

const referralWithReward = Prisma.validator<Prisma.ReferralDefaultArgs>()({
  include: { reward: true },
});
type ReferralWithReward = Prisma.ReferralGetPayload<typeof referralWithReward>;

/**
 * Invite Friends / Referrals (M20). Owns referral-code issuance (lazy,
 * collision-retried, TOCTOU-safe), share-event analytics, referral history,
 * signup attribution, and the completion-triggered reward grant. Depends only
 * on Prisma and the shared IdempotencyService, so proof/tasks can import this
 * one-directionally for their completion hook without any dependency cycle.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly notifications: NotificationsService,
  ) {}

  // --------------------------------------------------------------------------
  // M20.2 — GET /referrals/me
  // --------------------------------------------------------------------------

  async getMe(userId: string): Promise<ReferralMeDto> {
    const code = await this.ensureReferralCode(userId);

    const [totalReferrals, completedReferrals, pendingReferrals, invitesSent, rewardAgg] =
      await Promise.all([
        this.prisma.referral.count({ where: { referrerId: userId, refereeId: { not: null } } }),
        this.prisma.referral.count({
          where: { referrerId: userId, refereeId: { not: null }, status: ReferralStatus.Completed },
        }),
        this.prisma.referral.count({
          where: { referrerId: userId, refereeId: { not: null }, status: ReferralStatus.Pending },
        }),
        this.prisma.referral.count({ where: { referrerId: userId, refereeId: null } }),
        this.prisma.referralReward.aggregate({
          where: { userId, type: REFERRAL_REWARD_TYPE_XP },
          _sum: { amount: true },
        }),
      ]);

    return {
      code,
      inviteUrl: `${REFERRAL_INVITE_URL_PREFIX}${code}`,
      totalReferrals,
      completedReferrals,
      pendingReferrals,
      invitesSent,
      rewardsEarnedXp: rewardAgg._sum.amount ?? 0,
    };
  }

  /**
   * Returns the caller's referral code, minting one on the first-ever call.
   *
   * TOCTOU-safe (M20.1 acceptance: two concurrent first-ever calls for the same
   * user never produce two different codes). Mirrors the reserve-then-recover
   * idiom ProofService uses for its guest-limit race: the `userId` unique
   * constraint means only one concurrent `create` can win; the loser catches
   * the P2002 and re-reads *this user's* row, returning the winner's code
   * rather than minting a second one. A P2002 on `code` (an actual value
   * collision, not a same-user race) instead retries with a fresh code.
   */
  private async ensureReferralCode(userId: string): Promise<string> {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) {
      return existing.code;
    }

    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = generateReferralCode();
      try {
        const created = await this.prisma.referralCode.create({ data: { userId, code } });
        this.logger.log(`Referral code issued for user ${userId}`);
        return created.code;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        // A concurrent first-call for the SAME user already inserted their row —
        // return that code so both callers converge on one code.
        const raced = await this.prisma.referralCode.findUnique({ where: { userId } });
        if (raced) {
          return raced.code;
        }
        // Otherwise it was a genuine code-value collision; loop and try again.
        this.logger.warn(`Referral code collision on attempt ${attempt + 1}; retrying`);
      }
    }
    throw new ConflictException('Could not generate a unique referral code; please retry');
  }

  // --------------------------------------------------------------------------
  // M20.2 — POST /referrals/invites
  // --------------------------------------------------------------------------

  async recordInvite(
    userId: string,
    dto: RecordInviteDto,
    idempotencyKey?: string,
  ): Promise<InviteRecordedDto> {
    return this.idempotency.run({
      userId,
      key: idempotencyKey,
      endpoint: 'POST /referrals/invites',
      execute: async () => {
        // The code must exist so the analytics row denormalizes the same code
        // the shared link carried.
        const code = await this.ensureReferralCode(userId);
        await this.prisma.referral.create({
          data: { referrerId: userId, code, invitedVia: dto.channel },
        });
        const totalInvitesSent = await this.prisma.referral.count({
          where: { referrerId: userId, refereeId: null },
        });
        this.logger.log(`Invite share recorded for user ${userId} via ${dto.channel}`);
        return { success: true, channel: dto.channel, totalInvitesSent };
      },
    });
  }

  // --------------------------------------------------------------------------
  // M20.2 — GET /referrals/history
  // --------------------------------------------------------------------------

  async getHistory(
    userId: string,
    query: ReferralHistoryQueryDto,
  ): Promise<PaginatedReferralHistoryDto> {
    const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;
    const offset = query.offset ?? 0;
    const where: Prisma.ReferralWhereInput = { referrerId: userId, refereeId: { not: null } };

    const [rows, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: { reward: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.referral.count({ where }),
    ]);

    return { items: rows.map((row) => this.mapHistoryItem(row)), total, limit, offset };
  }

  // --------------------------------------------------------------------------
  // M20.3 — Signup attribution (called from AuthService)
  // --------------------------------------------------------------------------

  /**
   * Validates a referral code supplied at signup and returns the referrer's id,
   * or throws a 400 (M20.3 acceptance: an invalid code is a 400, never a silent
   * no-op or a 500). Called BEFORE the account write so an invalid code never
   * half-creates an account. When `candidateRefereeId` is known (the guest being
   * upgraded in place), a self-referral is rejected here too.
   */
  async resolveReferrer(code: string, candidateRefereeId?: string): Promise<string> {
    const referralCode = await this.prisma.referralCode.findUnique({ where: { code } });
    if (!referralCode) {
      throw new BadRequestException('Invalid referral code');
    }
    if (candidateRefereeId && referralCode.userId === candidateRefereeId) {
      throw new BadRequestException('You cannot refer yourself');
    }
    return referralCode.userId;
  }

  /**
   * Records the conversion referral once the referee's account exists. Called
   * AFTER the account write with a pre-resolved `referrerId`. Idempotent: the
   * `refereeId` unique constraint means a repeat attribution (e.g. a retried
   * signup) is swallowed rather than surfaced as an error.
   */
  async attributeSignup(params: {
    refereeId: string;
    referrerId: string;
    code: string;
  }): Promise<void> {
    const { refereeId, referrerId, code } = params;
    // Defensive: a brand-new account can never equal an existing referrer, but a
    // guest upgrading in place with their own code could — guard both paths.
    if (referrerId === refereeId) {
      this.logger.warn(`Ignoring self-referral for user ${refereeId}`);
      return;
    }
    try {
      await this.prisma.referral.create({
        data: {
          referrerId,
          refereeId,
          code,
          status: ReferralStatus.Pending,
          registeredAt: new Date(),
        },
      });
      this.logger.log(`Referral attributed: referrer ${referrerId} -> referee ${refereeId}`);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(`Referral already attributed for referee ${refereeId}; skipping`);
        return;
      }
      throw error;
    }

    // M21.5 — notify the referrer that someone registered with their code. Only
    // on a genuinely new attribution (the P2002 "already attributed" path above
    // returns before here, so a retried signup never re-notifies).
    await this.fireNotification({
      userId: referrerId,
      type: NotificationType.referral_registered,
      title: 'You have a new referral',
      body: 'Someone just signed up using your invite code.',
      data: { screen: 'referrals' },
    });
  }

  // --------------------------------------------------------------------------
  // Completion hook (called best-effort from ProofService and TasksService)
  // --------------------------------------------------------------------------

  /**
   * Qualifying trigger for a referral reward (Decision 4): the referee's first
   * approved completion. Called from both real completion sources — the curated
   * mission proof path (ProofService) and the peer-task approval path
   * (TasksService) — so a referee's first completion from *either* system
   * qualifies. A no-op when the user isn't a pending referee.
   *
   * Grants exactly once: the pending referral is locked `FOR UPDATE` and the
   * status re-checked inside the transaction, so two concurrent first
   * completions serialize and only the first flips Pending -> Completed and
   * creates the (unique-per-referral) reward. Because the referral is only
   * Pending until the first completion, later completions find nothing to grant.
   */
  async recordCompletionIfQualifying(userId: string): Promise<void> {
    const referral = await this.prisma.referral.findFirst({
      where: { refereeId: userId, status: ReferralStatus.Pending },
      select: { id: true },
    });
    if (!referral) {
      return;
    }

    // Set inside the transaction when a reward is actually granted, so the
    // reward-earned notification fires exactly once and only after commit (a
    // notification must never be sent for a reward that got rolled back).
    let rewardedReferrerId: string | null = null;
    let rewardedAmount = 0;
    let rewardedType = '';

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedReferralRow[]>`
        SELECT id, status, "referrerId"
        FROM "Referral"
        WHERE id = ${referral.id}
        FOR UPDATE`;
      const locked = rows[0];
      if (!locked || locked.status !== ReferralStatus.Pending) {
        return;
      }

      const rule = await tx.referralRewardRule.findFirst({
        where: { trigger: REFERRAL_COMPLETION_TRIGGER, isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      await tx.referral.update({
        where: { id: locked.id },
        data: { status: ReferralStatus.Completed, completedAt: new Date() },
      });

      if (!rule) {
        // No active rule configured — mark the referral complete for audit but
        // grant nothing (ops can seed/enable a rule later without this path
        // double-granting, since the referral is now Completed).
        this.logger.warn(
          `Referral ${locked.id} completed but no active '${REFERRAL_COMPLETION_TRIGGER}' rule; no reward granted`,
        );
        return;
      }

      await tx.referralReward.create({
        data: {
          referralId: locked.id,
          userId: locked.referrerId,
          type: rule.rewardType,
          amount: rule.rewardAmount,
        },
      });
      if (rule.rewardType === REFERRAL_REWARD_TYPE_XP && rule.rewardAmount > 0) {
        await tx.user.update({
          where: { id: locked.referrerId },
          data: { totalXp: { increment: rule.rewardAmount } },
        });
      }
      rewardedReferrerId = locked.referrerId;
      rewardedAmount = rule.rewardAmount;
      rewardedType = rule.rewardType;
      this.logger.log(
        `Referral ${locked.id} completed; +${rule.rewardAmount} ${rule.rewardType} to referrer ${locked.referrerId}`,
      );
    });

    // M21.5 — notify the referrer that they earned a reward, post-commit so a
    // rolled-back grant never produces a phantom notification.
    if (rewardedReferrerId) {
      const earned =
        rewardedType === REFERRAL_REWARD_TYPE_XP && rewardedAmount > 0
          ? `You earned ${rewardedAmount} XP because your referral completed their first quest.`
          : 'Your referral completed their first quest.';
      await this.fireNotification({
        userId: rewardedReferrerId,
        type: NotificationType.referral_reward_earned,
        title: 'Referral reward earned',
        body: earned,
        data: { screen: 'referrals' },
      });
    }
  }

  /**
   * Fires a notification best-effort. Wrapped in its own try/catch-and-log so a
   * notification failure can never break the referral operation it is attached
   * to — the same isolation TasksService/ProofService apply around their
   * cross-module hook calls (and the fix M20's review demanded after an
   * un-isolated AuthService->ReferralsService call could 500 a committed signup).
   */
  private async fireNotification(params: NotifyParams): Promise<void> {
    try {
      await this.notifications.notify(params);
    } catch (error) {
      this.logger.error(
        `Notification hook failed for user ${params.userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private mapHistoryItem(row: ReferralWithReward): ReferralHistoryItemDto {
    return {
      id: row.id,
      // refereeId is guaranteed non-null by the query filter, but the Prisma
      // type is nullable — coerce to the DTO's contract.
      refereeId: row.refereeId as string,
      status: row.status,
      code: row.code,
      registeredAt: row.registeredAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      rewardXp: row.reward?.amount ?? null,
    };
  }
}
