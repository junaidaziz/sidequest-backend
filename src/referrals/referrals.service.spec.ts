import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ReferralStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService, IdempotentRunParams } from '../idempotency/idempotency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReferralsService } from './referrals.service';

const USER = 'user-1';

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

interface Tx {
  $queryRaw: jest.Mock;
  referral: { update: jest.Mock };
  referralRewardRule: { findFirst: jest.Mock };
  referralReward: { create: jest.Mock };
  user: { update: jest.Mock };
}

describe('ReferralsService', () => {
  let service: ReferralsService;
  let tx: Tx;
  let prisma: {
    referralCode: { findUnique: jest.Mock; create: jest.Mock };
    referral: {
      count: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    referralReward: { aggregate: jest.Mock };
    $transaction: jest.Mock;
  };
  let idempotency: { run: jest.Mock };
  let notifications: { notify: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      referral: { update: jest.fn().mockResolvedValue({}) },
      referralRewardRule: { findFirst: jest.fn() },
      referralReward: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      referralCode: { findUnique: jest.fn(), create: jest.fn() },
      referral: {
        count: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      referralReward: { aggregate: jest.fn() },
      $transaction: jest.fn(async (cb: (t: Tx) => Promise<unknown>) => cb(tx)),
    };
    idempotency = {
      run: jest.fn((params: IdempotentRunParams<unknown>) => params.execute()),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new ReferralsService(
      prisma as unknown as PrismaService,
      idempotency as unknown as IdempotencyService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('getMe', () => {
    beforeEach(() => {
      prisma.referral.count.mockResolvedValue(0);
      prisma.referralReward.aggregate.mockResolvedValue({ _sum: { amount: null } });
    });

    it('returns the existing code without minting a new one', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({ code: 'EXIST123' });

      const result = await service.getMe(USER);

      expect(prisma.referralCode.create).not.toHaveBeenCalled();
      expect(result.code).toBe('EXIST123');
      expect(result.inviteUrl).toBe('sidequest://referrals/invite/EXIST123');
    });

    it('mints a code on the first-ever call and computes stats', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null);
      prisma.referralCode.create.mockImplementation(({ data }) =>
        Promise.resolve({ code: data.code }),
      );
      prisma.referral.count
        .mockResolvedValueOnce(3) // totalReferrals
        .mockResolvedValueOnce(1) // completedReferrals
        .mockResolvedValueOnce(2) // pendingReferrals
        .mockResolvedValueOnce(5); // invitesSent
      prisma.referralReward.aggregate.mockResolvedValue({ _sum: { amount: 50 } });

      const result = await service.getMe(USER);

      expect(prisma.referralCode.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        totalReferrals: 3,
        completedReferrals: 1,
        pendingReferrals: 2,
        invitesSent: 5,
        rewardsEarnedXp: 50,
      });
      expect(result.code).toHaveLength(8);
    });

    it('defaults rewardsEarnedXp to 0 when no rewards exist', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({ code: 'EXIST123' });

      const result = await service.getMe(USER);

      expect(result.rewardsEarnedXp).toBe(0);
    });
  });

  describe('ensureReferralCode (via getMe) — TOCTOU safety', () => {
    beforeEach(() => {
      prisma.referral.count.mockResolvedValue(0);
      prisma.referralReward.aggregate.mockResolvedValue({ _sum: { amount: null } });
    });

    it("returns the concurrent winner's code when create loses the userId race", async () => {
      prisma.referralCode.findUnique
        .mockResolvedValueOnce(null) // initial: none yet
        .mockResolvedValueOnce({ code: 'WINNER12' }); // re-read after P2002 on userId
      prisma.referralCode.create.mockRejectedValue(p2002(['userId']));

      const result = await service.getMe(USER);

      expect(result.code).toBe('WINNER12');
      expect(prisma.referralCode.create).toHaveBeenCalledTimes(1);
    });

    it('retries with a fresh code on a genuine code-value collision', async () => {
      prisma.referralCode.findUnique
        .mockResolvedValueOnce(null) // initial
        .mockResolvedValueOnce(null); // re-read after collision: still no row for this user
      prisma.referralCode.create
        .mockRejectedValueOnce(p2002(['code'])) // first attempt collides
        .mockImplementationOnce(({ data }) => Promise.resolve({ code: data.code })); // retry wins

      const result = await service.getMe(USER);

      expect(prisma.referralCode.create).toHaveBeenCalledTimes(2);
      expect(result.code).toHaveLength(8);
    });

    it('rethrows a non-P2002 database error', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null);
      prisma.referralCode.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.getMe(USER)).rejects.toThrow('connection lost');
    });

    it('throws ConflictException after exhausting collision retries', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null);
      prisma.referralCode.create.mockRejectedValue(p2002(['code']));

      await expect(service.getMe(USER)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.referralCode.create).toHaveBeenCalledTimes(5);
    });
  });

  describe('recordInvite', () => {
    it('creates an invite-sent row and returns the running count via idempotency', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({ code: 'MYCODE12' });
      prisma.referral.create.mockResolvedValue({});
      prisma.referral.count.mockResolvedValue(4);

      const result = await service.recordInvite(USER, { channel: 'whatsapp' }, 'idem-key');

      expect(idempotency.run).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          key: 'idem-key',
          endpoint: 'POST /referrals/invites',
        }),
      );
      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: { referrerId: USER, code: 'MYCODE12', invitedVia: 'whatsapp' },
      });
      expect(result).toEqual({ success: true, channel: 'whatsapp', totalInvitesSent: 4 });
    });
  });

  describe('getHistory', () => {
    it('returns paginated conversion referrals with reward XP mapped', async () => {
      prisma.referral.findMany.mockResolvedValue([
        {
          id: 'r-1',
          refereeId: 'referee-1',
          status: ReferralStatus.Completed,
          code: 'CODE1234',
          registeredAt: new Date('2026-07-01T00:00:00Z'),
          completedAt: new Date('2026-07-02T00:00:00Z'),
          createdAt: new Date('2026-07-01T00:00:00Z'),
          reward: { amount: 50 },
        },
        {
          id: 'r-2',
          refereeId: 'referee-2',
          status: ReferralStatus.Pending,
          code: 'CODE1234',
          registeredAt: new Date('2026-07-03T00:00:00Z'),
          completedAt: null,
          createdAt: new Date('2026-07-03T00:00:00Z'),
          reward: null,
        },
      ]);
      prisma.referral.count.mockResolvedValue(2);

      const result = await service.getHistory(USER, { limit: 10, offset: 0 });

      expect(prisma.referral.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 0 }),
      );
      expect(result.total).toBe(2);
      expect(result.items[0].rewardXp).toBe(50);
      expect(result.items[1].rewardXp).toBeNull();
    });

    it('applies default limit/offset when omitted', async () => {
      prisma.referral.findMany.mockResolvedValue([]);
      prisma.referral.count.mockResolvedValue(0);

      const result = await service.getHistory(USER, {});

      expect(prisma.referral.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 0 }),
      );
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });
  });

  describe('resolveReferrer', () => {
    it('returns the referrer id for a valid code', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({ userId: 'referrer-1' });

      await expect(service.resolveReferrer('CODE1234')).resolves.toBe('referrer-1');
    });

    it('throws BadRequestException for an unknown code', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null);

      await expect(service.resolveReferrer('NOPE0000')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a self-referral when the candidate referee owns the code', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({ userId: 'me' });

      await expect(service.resolveReferrer('CODE1234', 'me')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('attributeSignup', () => {
    it('creates a pending conversion referral', async () => {
      prisma.referral.create.mockResolvedValue({});

      await service.attributeSignup({ refereeId: 'ref-1', referrerId: 'referrer-1', code: 'C' });

      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          referrerId: 'referrer-1',
          refereeId: 'ref-1',
          code: 'C',
          status: ReferralStatus.Pending,
          registeredAt: expect.any(Date),
        }),
      });
    });

    it('notifies the referrer that a new referral registered (M21.5)', async () => {
      prisma.referral.create.mockResolvedValue({});

      await service.attributeSignup({ refereeId: 'ref-1', referrerId: 'referrer-1', code: 'C' });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'referrer-1', type: 'referral_registered' }),
      );
    });

    it('does not break attribution when the notification hook throws', async () => {
      prisma.referral.create.mockResolvedValue({});
      notifications.notify.mockRejectedValue(new Error('redis down'));

      await expect(
        service.attributeSignup({ refereeId: 'ref-1', referrerId: 'referrer-1', code: 'C' }),
      ).resolves.toBeUndefined();
    });

    it('is a no-op self-referral guard when referrer equals referee', async () => {
      await service.attributeSignup({ refereeId: 'same', referrerId: 'same', code: 'C' });

      expect(prisma.referral.create).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('swallows a P2002 (already attributed) rather than throwing, and does not notify', async () => {
      prisma.referral.create.mockRejectedValue(p2002(['refereeId']));

      await expect(
        service.attributeSignup({ refereeId: 'ref-1', referrerId: 'referrer-1', code: 'C' }),
      ).resolves.toBeUndefined();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('rethrows a non-P2002 database error', async () => {
      prisma.referral.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.attributeSignup({ refereeId: 'ref-1', referrerId: 'referrer-1', code: 'C' }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('recordCompletionIfQualifying', () => {
    it('is a no-op when the user is not a pending referee', async () => {
      prisma.referral.findFirst.mockResolvedValue(null);

      await service.recordCompletionIfQualifying('someone');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('completes the referral and grants XP to the referrer', async () => {
      prisma.referral.findFirst.mockResolvedValue({ id: 'r-1' });
      tx.$queryRaw.mockResolvedValue([
        { id: 'r-1', status: ReferralStatus.Pending, referrerId: 'referrer-1' },
      ]);
      tx.referralRewardRule.findFirst.mockResolvedValue({ rewardType: 'xp', rewardAmount: 50 });

      await service.recordCompletionIfQualifying('referee-1');

      expect(tx.referral.update).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: { status: ReferralStatus.Completed, completedAt: expect.any(Date) },
      });
      expect(tx.referralReward.create).toHaveBeenCalledWith({
        data: { referralId: 'r-1', userId: 'referrer-1', type: 'xp', amount: 50 },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'referrer-1' },
        data: { totalXp: { increment: 50 } },
      });
      // M21.5 — the referrer is notified of the earned reward, post-commit.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'referrer-1', type: 'referral_reward_earned' }),
      );
    });

    it('does not grant XP for a non-xp reward type', async () => {
      prisma.referral.findFirst.mockResolvedValue({ id: 'r-1' });
      tx.$queryRaw.mockResolvedValue([
        { id: 'r-1', status: ReferralStatus.Pending, referrerId: 'referrer-1' },
      ]);
      tx.referralRewardRule.findFirst.mockResolvedValue({ rewardType: 'coupon', rewardAmount: 1 });

      await service.recordCompletionIfQualifying('referee-1');

      expect(tx.referralReward.create).toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('completes the referral but grants nothing when no active rule exists', async () => {
      prisma.referral.findFirst.mockResolvedValue({ id: 'r-1' });
      tx.$queryRaw.mockResolvedValue([
        { id: 'r-1', status: ReferralStatus.Pending, referrerId: 'referrer-1' },
      ]);
      tx.referralRewardRule.findFirst.mockResolvedValue(null);

      await service.recordCompletionIfQualifying('referee-1');

      expect(tx.referral.update).toHaveBeenCalled();
      expect(tx.referralReward.create).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      // No reward granted => no reward-earned notification.
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not double-grant when the locked row is no longer Pending', async () => {
      prisma.referral.findFirst.mockResolvedValue({ id: 'r-1' });
      tx.$queryRaw.mockResolvedValue([
        { id: 'r-1', status: ReferralStatus.Completed, referrerId: 'referrer-1' },
      ]);

      await service.recordCompletionIfQualifying('referee-1');

      expect(tx.referral.update).not.toHaveBeenCalled();
      expect(tx.referralReward.create).not.toHaveBeenCalled();
    });

    it('is a no-op when the locked row disappeared', async () => {
      prisma.referral.findFirst.mockResolvedValue({ id: 'r-1' });
      tx.$queryRaw.mockResolvedValue([]);

      await service.recordCompletionIfQualifying('referee-1');

      expect(tx.referral.update).not.toHaveBeenCalled();
    });
  });
});
