import { ConflictException, NotFoundException } from '@nestjs/common';
import { User, VerificationStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaService } from '../media/media.service';
import { AdminUserActionContext, AdminUsersService } from './admin-users.service';
import { RestrictableFeature, UserAccountStatus } from './admin-users.constants';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    passwordHash: 'hash',
    refreshTokenHash: 'rt',
    refreshPreviousTokenHash: null,
    googleId: null,
    displayName: 'Ada',
    avatarUrl: null,
    avatarMediaId: null,
    stripeCustomerId: null,
    isGuest: false,
    totalXp: 250,
    currentStreak: 3,
    longestStreak: 9,
    lastCompletionDate: new Date('2026-07-01'),
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    deletedAt: null,
    suspendedAt: null,
    suspensionReason: null,
    suspendedByAdminId: null,
    restrictedFeatures: [],
    ...overrides,
  };
}

const CTX: AdminUserActionContext = {
  actorAdminUserId: 'admin-1',
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
};

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let prisma: {
    user: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    completion: { findMany: jest.Mock };
    userTask: { findMany: jest.Mock };
    report: { findMany: jest.Mock };
    moderationAction: { findMany: jest.Mock };
    referralCode: { count: jest.Mock };
    referral: { count: jest.Mock };
    referralReward: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let storage: { getSignedDownloadUrl: jest.Mock };
  let authService: { anonymizeUserAccount: jest.Mock };
  let media: { resolveVariantsForAsset: jest.Mock };
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock; completion: { update: jest.Mock } };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      completion: { update: jest.fn() },
    };
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      completion: { findMany: jest.fn().mockResolvedValue([]) },
      userTask: { findMany: jest.fn().mockResolvedValue([]) },
      report: { findMany: jest.fn().mockResolvedValue([]) },
      moderationAction: { findMany: jest.fn().mockResolvedValue([]) },
      referralCode: { count: jest.fn().mockResolvedValue(0) },
      referral: { count: jest.fn().mockResolvedValue(0) },
      referralReward: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (t: typeof tx) => unknown)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    storage = { getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/url') };
    authService = { anonymizeUserAccount: jest.fn().mockResolvedValue(undefined) };
    media = { resolveVariantsForAsset: jest.fn().mockResolvedValue([]) };

    service = new AdminUsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      storage as unknown as StorageService,
      authService as unknown as AuthService,
      media as unknown as MediaService,
    );
  });

  describe('list', () => {
    it('paginates and maps rows with derived status + level', async () => {
      prisma.user.findMany.mockResolvedValue([buildUser(), buildUser({ id: 'user-2' })]);
      prisma.user.count.mockResolvedValue(2);

      const result = await service.list({ page: 1, pageSize: 25 } as ListUsersQueryDto);

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].status).toBe(UserAccountStatus.Active);
      // totalXp 250 -> level 3 on the flat 100-XP curve.
      expect(result.items[0].level).toBe(3);
    });

    it('applies default page/pageSize when omitted', async () => {
      await service.list({} as ListUsersQueryDto);
      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(25);
    });

    it('builds a search OR filter', async () => {
      await service.list({ search: 'ada' } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { email: { contains: 'ada', mode: 'insensitive' } },
        { displayName: { contains: 'ada', mode: 'insensitive' } },
      ]);
    });

    it('filters by active status', async () => {
      await service.list({ status: UserAccountStatus.Active } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.suspendedAt).toBeNull();
    });

    it('filters by suspended status', async () => {
      await service.list({ status: UserAccountStatus.Suspended } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.suspendedAt).toEqual({ not: null });
    });

    it('filters by deleted status', async () => {
      await service.list({ status: UserAccountStatus.Deleted } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toEqual({ not: null });
    });

    it('filters by registration and last-completion date ranges', async () => {
      await service.list({
        registeredFrom: '2026-01-01',
        registeredTo: '2026-02-01',
        lastCompletionFrom: '2026-03-01',
        lastCompletionTo: '2026-04-01',
      } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toBeInstanceOf(Date);
      expect(where.createdAt.lte).toBeInstanceOf(Date);
      expect(where.lastCompletionDate.gte).toBeInstanceOf(Date);
      expect(where.lastCompletionDate.lte).toBeInstanceOf(Date);
    });

    it('filters to users with challenge participation via a top-level AND', async () => {
      await service.list({ hasChallengeParticipation: true } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { OR: [{ createdTasks: { some: {} } }, { assignedTasks: { some: {} } }] },
      ]);
    });

    it('ANDs participation with search instead of merging into the search OR', async () => {
      await service.list({
        search: 'ada',
        hasChallengeParticipation: true,
      } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      // The search OR stays intact and independent...
      expect(where.OR).toEqual([
        { email: { contains: 'ada', mode: 'insensitive' } },
        { displayName: { contains: 'ada', mode: 'insensitive' } },
      ]);
      // ...and the participation constraint is a separate, mandatory AND clause,
      // so a search+participation query can't return non-matching participants.
      expect(where.AND).toEqual([
        { OR: [{ createdTasks: { some: {} } }, { assignedTasks: { some: {} } }] },
      ]);
    });

    it('filters to users without challenge participation', async () => {
      await service.list({ hasChallengeParticipation: false } as ListUsersQueryDto);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.createdTasks).toEqual({ none: {} });
      expect(where.assignedTasks).toEqual({ none: {} });
    });

    it('filters by guest flag', async () => {
      await service.list({ isGuest: true } as ListUsersQueryDto);
      expect(prisma.user.findMany.mock.calls[0][0].where.isGuest).toBe(true);
    });
  });

  describe('getDetail', () => {
    it('throws NotFound when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('assembles proof, challenge and moderation history with presigned URLs', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ avatarUrl: 'avatars/a.png' }));
      prisma.completion.findMany.mockResolvedValue([
        {
          id: 'c1',
          missionId: 'm1',
          mission: { title: 'Mission One' },
          proofType: 'photo',
          proofKey: 'proofs/p.png',
          proofText: null,
          xpAwarded: 50,
          verificationStatus: VerificationStatus.Approved,
          completedAt: new Date(),
          verifiedAt: new Date(),
          rejectionReason: null,
        },
      ]);
      prisma.userTask.findMany
        .mockResolvedValueOnce([
          { id: 't1', title: 'Made', status: 'Open', rewardXp: 10, createdAt: new Date() },
        ])
        .mockResolvedValueOnce([
          {
            id: 't2',
            title: 'Assigned',
            status: 'Accepted',
            rewardXp: null,
            createdAt: new Date(),
          },
        ]);
      prisma.report.findMany.mockResolvedValue([
        { id: 'r1', reason: 'spam', status: 'Open', createdAt: new Date() },
      ]);
      prisma.moderationAction.findMany.mockResolvedValue([
        {
          id: 'ma1',
          actionType: 'WarnUser',
          reason: 'rude',
          reversedAt: null,
          createdAt: new Date(),
        },
      ]);

      const detail = await service.getDetail('user-1');

      expect(detail.avatarUrl).toBe('https://signed/url');
      expect(detail.proofHistory).toHaveLength(1);
      expect(detail.proofHistory[0].proofUrl).toBe('https://signed/url');
      expect(detail.proofHistory[0].missionTitle).toBe('Mission One');
      expect(detail.challenges.map((c) => c.role)).toEqual(['creator', 'assignee']);
      expect(detail.moderation.reportsAgainst).toHaveLength(1);
      expect(detail.moderation.actionsAgainst).toHaveLength(1);
    });

    it('leaves proofUrl null when the proof key was de-referenced', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.completion.findMany.mockResolvedValue([
        {
          id: 'c1',
          missionId: 'm1',
          mission: { title: 'M' },
          proofType: 'text',
          proofKey: null,
          proofText: 'did it',
          xpAwarded: 50,
          verificationStatus: VerificationStatus.Pending,
          completedAt: new Date(),
          verifiedAt: null,
          rejectionReason: null,
        },
      ]);

      const detail = await service.getDetail('user-1');
      expect(detail.proofHistory[0].proofUrl).toBeNull();
      expect(detail.avatarUrl).toBeNull();
    });

    it('resolves a media-pipeline avatar (avatarMediaId) instead of showing null', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ avatarUrl: null, avatarMediaId: 'media-1' }),
      );
      media.resolveVariantsForAsset.mockResolvedValue([
        { name: 'sm', url: 'https://cdn.example/sm.webp', width: 150, height: 150, format: 'webp' },
        { name: 'lg', url: 'https://cdn.example/lg.webp', width: 320, height: 320, format: 'webp' },
      ]);

      const detail = await service.getDetail('user-1');

      expect(media.resolveVariantsForAsset).toHaveBeenCalledWith('media-1');
      expect(detail.avatarUrl).toBe('https://cdn.example/lg.webp');
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('suspend', () => {
    it('throws NotFound for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.suspend('x', { reason: 'abuse' }, CTX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects suspending a deleted account', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));
      await expect(service.suspend('user-1', { reason: 'abuse' }, CTX)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects re-suspending an already-suspended account', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ suspendedAt: new Date() }));
      await expect(service.suspend('user-1', { reason: 'abuse' }, CTX)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('suspends: writes fields, revokes refresh token, and audits', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.user.update.mockResolvedValue(buildUser({ suspendedAt: new Date() }));

      await service.suspend('user-1', { reason: 'abuse' }, CTX);

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.suspendedAt).toBeInstanceOf(Date);
      expect(data.suspensionReason).toBe('abuse');
      expect(data.suspendedByAdminId).toBe('admin-1');
      expect(data.refreshTokenHash).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'users.suspend', targetId: 'user-1' }),
      );
    });
  });

  describe('reactivate', () => {
    it('throws NotFound for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.reactivate('x', CTX)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects reactivating an account that is not suspended', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      await expect(service.reactivate('user-1', CTX)).rejects.toBeInstanceOf(ConflictException);
    });

    it('clears the suspension fields and audits', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ suspendedAt: new Date() }));
      prisma.user.update.mockResolvedValue(buildUser());

      await service.reactivate('user-1', CTX);

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).toEqual({
        suspendedAt: null,
        suspensionReason: null,
        suspendedByAdminId: null,
      });
      expect(audit.record).toHaveBeenCalled();
    });
  });

  describe('restrict', () => {
    it('throws NotFound for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.restrict('x', { features: [], reason: 'r' }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects restricting a deleted account', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));
      await expect(
        service.restrict('user-1', { features: [], reason: 'r' }, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('replaces the restriction set (de-duplicated) and audits', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.user.update.mockResolvedValue(buildUser());

      await service.restrict(
        'user-1',
        {
          features: [RestrictableFeature.ProofSubmission, RestrictableFeature.ProofSubmission],
          reason: 'spammy proofs',
        },
        CTX,
      );

      expect(prisma.user.update.mock.calls[0][0].data.restrictedFeatures).toEqual([
        RestrictableFeature.ProofSubmission,
      ]);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'users.edit' }));
    });
  });

  describe('resetVerification', () => {
    it('throws NotFound when the completion is not the user’s', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'c1',
          userId: 'other',
          xpAwarded: 50,
          verificationStatus: VerificationStatus.Approved,
        },
      ]);
      await expect(
        service.resetVerification('user-1', { completionId: 'c1' }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the completion does not exist', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.resetVerification('user-1', { completionId: 'c1' }, CTX),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a completion already Pending', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'c1',
          userId: 'user-1',
          xpAwarded: 50,
          verificationStatus: VerificationStatus.Pending,
        },
      ]);
      await expect(
        service.resetVerification('user-1', { completionId: 'c1' }, CTX),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('restores reversed XP when resetting a Rejected completion', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'c1',
          userId: 'user-1',
          xpAwarded: 50,
          verificationStatus: VerificationStatus.Rejected,
        },
      ]);
      tx.completion.update.mockResolvedValue({
        id: 'c1',
        verificationStatus: VerificationStatus.Pending,
      });

      const res = await service.resetVerification('user-1', { completionId: 'c1' }, CTX);

      expect(res.verificationStatus).toBe(VerificationStatus.Pending);
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'users.edit', targetId: 'user-1' }),
      );
    });

    it('does not change XP when resetting an Approved completion', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'c1',
          userId: 'user-1',
          xpAwarded: 50,
          verificationStatus: VerificationStatus.Approved,
        },
      ]);
      tx.completion.update.mockResolvedValue({
        id: 'c1',
        verificationStatus: VerificationStatus.Pending,
      });

      await service.resetVerification('user-1', { completionId: 'c1', reason: 'mistake' }, CTX);

      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('throws NotFound for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.deleteUser('x', 'gdpr', CTX)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for an already-deleted user', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));
      await expect(service.deleteUser('user-1', 'gdpr', CTX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reuses AuthService anonymization and audits', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ avatarUrl: 'a/b.png' }));

      await service.deleteUser('user-1', 'gdpr request', CTX);

      expect(authService.anonymizeUserAccount).toHaveBeenCalledWith('user-1', 'a/b.png', null);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'users.delete', targetId: 'user-1' }),
      );
    });
  });

  describe('exportUser', () => {
    it('throws NotFound for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.exportUser('x', CTX)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the profile plus referral counts and audits the export', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.referralCode.count.mockResolvedValue(1);
      prisma.referral.count.mockResolvedValue(2);
      prisma.referralReward.count.mockResolvedValue(3);

      const result = await service.exportUser('user-1', CTX);

      expect(result.profile.id).toBe('user-1');
      expect(result.referrals).toEqual({ codesMade: 1, conversions: 2, rewardsEarned: 3 });
      expect(result.exportedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'users.export' }),
      );
    });
  });
});
