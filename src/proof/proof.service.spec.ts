import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProofType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { VerificationQueueService } from '../verification/verification-queue.service';
import { ReferralsService } from '../referrals/referrals.service';
import { IdempotencyService, IdempotentRunParams } from '../idempotency/idempotency.service';
import { ProofService } from './proof.service';

interface TxMock {
  $queryRaw: jest.Mock;
  completion: { count: jest.Mock; create: jest.Mock };
  user: { update: jest.Mock };
}

interface PrismaMock {
  mission: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  completion: { count: jest.Mock };
  $transaction: jest.Mock;
}

interface StorageMock {
  buildProofKey: jest.Mock;
  uploadObject: jest.Mock;
  getSignedDownloadUrl: jest.Mock;
}

interface VerificationQueueMock {
  enqueueAutoApprove: jest.Mock;
}

const MISSION_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function activeMission() {
  return {
    id: MISSION_ID,
    title: 'Find the Oldest Thing',
    isActive: true,
    deletedAt: null,
    xpReward: 40,
  };
}

/** The row returned by the fast-path `prisma.user.findUnique` precheck. */
function precheckUser(overrides: Record<string, unknown> = {}) {
  return { id: USER_ID, isGuest: true, ...overrides };
}

/**
 * The row returned by the locked `tx.$queryRaw(... FOR UPDATE)` re-check.
 * `timezone` is set explicitly (rather than left undefined to fall back to UTC by
 * coincidence) so the streak computation's timezone threading is exercised on the
 * value the service actually reads off the locked row — override it to a non-UTC
 * zone to assert local-day behaviour.
 */
function lockedUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    isGuest: true,
    currentStreak: 0,
    longestStreak: 0,
    lastCompletionDate: null,
    timezone: 'UTC',
    ...overrides,
  };
}

function photoFile(mimetype = 'image/png'): Express.Multer.File {
  return {
    fieldname: 'photo',
    originalname: 'proof.png',
    encoding: '7bit',
    mimetype,
    size: 3,
    buffer: Buffer.from('img'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };
}

describe('ProofService', () => {
  let service: ProofService;
  let prisma: PrismaMock;
  let tx: TxMock;
  let storage: StorageMock;
  let verificationQueue: VerificationQueueMock;
  let referrals: { recordCompletionIfQualifying: jest.Mock };
  let idempotency: { run: jest.Mock };

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn(),
      completion: { count: jest.fn(), create: jest.fn() },
      user: { update: jest.fn() },
    };
    prisma = {
      mission: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      completion: { count: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: TxMock) => Promise<unknown>) => callback(tx)),
    };
    storage = {
      buildProofKey: jest.fn(),
      uploadObject: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };
    verificationQueue = {
      enqueueAutoApprove: jest.fn().mockResolvedValue(undefined),
    };
    referrals = {
      recordCompletionIfQualifying: jest.fn().mockResolvedValue(undefined),
    };
    // Idempotency wrapper is transparent in unit tests: run the operation
    // straight through so the existing behavioural assertions still apply.
    idempotency = {
      run: jest.fn((p: IdempotentRunParams<unknown>) => p.execute()),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ProofService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: VerificationQueueService, useValue: verificationQueue },
        { provide: ReferralsService, useValue: referrals },
        { provide: IdempotencyService, useValue: idempotency },
      ],
    }).compile();

    service = moduleRef.get(ProofService);
  });

  /** Wires the mocks for a successful completion so happy-path tests stay terse. */
  function stubHappyTransaction(overrides: Record<string, unknown> = {}): void {
    prisma.mission.findUnique.mockResolvedValue(activeMission());
    prisma.user.findUnique.mockResolvedValue(precheckUser(overrides));
    prisma.completion.count.mockResolvedValue(0);
    tx.$queryRaw.mockResolvedValue([lockedUserRow(overrides)]);
    tx.completion.count.mockResolvedValue(0);
    tx.completion.create.mockResolvedValue({ id: 'completion-1', xpAwarded: 40 });
    tx.user.update.mockResolvedValue({ totalXp: 40, currentStreak: 1, longestStreak: 1 });
  }

  describe('mutual-exclusivity validation', () => {
    it('rejects when both a photo and a caption are supplied', async () => {
      await expect(
        service.submitProof(USER_ID, MISSION_ID, photoFile(), 'a caption'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.mission.findUnique).not.toHaveBeenCalled();
    });

    it('rejects when neither a photo nor a caption is supplied', async () => {
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('treats an empty-string caption as "no caption" (rejects alongside no photo)', async () => {
      await expect(service.submitProof(USER_ID, MISSION_ID, undefined, '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('mission lookup', () => {
    it('throws 404 when the mission does not exist', async () => {
      prisma.mission.findUnique.mockResolvedValue(null);
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when the mission is inactive', async () => {
      prisma.mission.findUnique.mockResolvedValue({ ...activeMission(), isActive: false });
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when the mission is soft-deleted', async () => {
      prisma.mission.findUnique.mockResolvedValue({ ...activeMission(), deletedAt: new Date() });
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('user lookup', () => {
    it('throws 404 when the user row is missing (defensive)', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('guest gate — fast path', () => {
    it('allows a guest with 0 prior completions', async () => {
      stubHappyTransaction();
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-1' });
      expect(prisma.completion.count).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    });

    it('rejects a guest with 1+ prior completions with the exact reason string, without opening a transaction', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(precheckUser());
      prisma.completion.count.mockResolvedValue(1);

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toMatchObject({ message: 'GUEST_COMPLETION_LIMIT_REACHED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips the fast-path count query entirely for a signed-in (non-guest) user', async () => {
      stubHappyTransaction({ isGuest: false });
      tx.completion.create.mockResolvedValue({ id: 'completion-9', xpAwarded: 40 });
      tx.user.update.mockResolvedValue({ totalXp: 540, currentStreak: 1, longestStreak: 1 });

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-9' });
      expect(prisma.completion.count).not.toHaveBeenCalled();
      expect(tx.completion.count).not.toHaveBeenCalled();
    });
  });

  describe('guest gate — locked authoritative re-check (race-condition fix)', () => {
    it('rejects a guest who cleared the fast-path check but already has a completion by the time the row lock is acquired', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(precheckUser());
      // Fast-path (outside any lock) sees 0 — simulates a request that raced
      // ahead of a concurrent completion which hasn't committed yet.
      prisma.completion.count.mockResolvedValue(0);
      tx.$queryRaw.mockResolvedValue([lockedUserRow()]);
      // Authoritative check, taken under the row lock, sees the now-committed
      // concurrent completion.
      tx.completion.count.mockResolvedValue(1);

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toMatchObject({ message: 'GUEST_COMPLETION_LIMIT_REACHED' });
      expect(tx.completion.create).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('locks the user row with SELECT ... FOR UPDATE inside the transaction', async () => {
      stubHappyTransaction();

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption');

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [strings] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(strings.join('')).toContain('FOR UPDATE');
    });

    it('throws 404 when the locked row query returns nothing (user deleted mid-request)', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(precheckUser());
      prisma.completion.count.mockResolvedValue(0);
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('text proof', () => {
    it('stores the caption, awards XP, and returns no proofUrl', async () => {
      stubHappyTransaction();

      const result = await service.submitProof(USER_ID, MISSION_ID, undefined, 'Found it!');

      expect(storage.uploadObject).not.toHaveBeenCalled();
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
      expect(tx.completion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proofType: ProofType.text,
            proofText: 'Found it!',
            proofKey: null,
            xpAwarded: 40,
          }),
        }),
      );
      expect(result).toEqual({
        completionId: 'completion-1',
        missionTitle: 'Find the Oldest Thing',
        xpAwarded: 40,
        totalXp: 40,
        currentStreak: 1,
        longestStreak: 1,
        proofUrl: null,
      });
    });
  });

  describe('photo proof', () => {
    it('uploads the photo before opening the transaction, stores the key, and returns a presigned proofUrl', async () => {
      stubHappyTransaction();
      storage.buildProofKey.mockReturnValue('proofs/user/abc.png');
      storage.getSignedDownloadUrl.mockResolvedValue('https://signed.example/proof');

      const result = await service.submitProof(USER_ID, MISSION_ID, photoFile(), undefined);

      expect(storage.buildProofKey).toHaveBeenCalledWith(USER_ID, 'image/png');
      expect(storage.uploadObject).toHaveBeenCalledWith(
        'proofs/user/abc.png',
        expect.any(Buffer),
        'image/png',
      );
      expect(tx.completion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proofType: ProofType.photo,
            proofKey: 'proofs/user/abc.png',
            proofText: null,
          }),
        }),
      );
      expect(result.proofUrl).toBe('https://signed.example/proof');
    });

    it('propagates a 400 from the storage layer for an unsupported image type', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(precheckUser());
      prisma.completion.count.mockResolvedValue(0);
      storage.buildProofKey.mockImplementation(() => {
        throw new BadRequestException('UNSUPPORTED_IMAGE_TYPE');
      });

      await expect(
        service.submitProof(USER_ID, MISSION_ID, photoFile('image/gif'), undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadObject).not.toHaveBeenCalled();
    });
  });

  describe('atomic XP/streak write', () => {
    it('increments XP and sets the fresh-streak fields inside the locked transaction', async () => {
      stubHappyTransaction();

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.completion.create).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({
            totalXp: { increment: 40 },
            currentStreak: 1,
            longestStreak: 1,
            lastCompletionDate: expect.any(Date),
          }),
        }),
      );
    });

    it('computes the streak from the locked row state, not the fast-path precheck state', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(precheckUser());
      prisma.completion.count.mockResolvedValue(0);
      // Locked row reports a streak already in progress — a concurrent
      // completion from the same user could have advanced this between the
      // fast-path precheck and the lock being acquired.
      tx.$queryRaw.mockResolvedValue([
        lockedUserRow({
          currentStreak: 4,
          longestStreak: 5,
          lastCompletionDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        }),
      ]);
      tx.completion.count.mockResolvedValue(0);
      tx.completion.create.mockResolvedValue({ id: 'completion-2', xpAwarded: 40 });
      tx.user.update.mockResolvedValue({ totalXp: 100, currentStreak: 5, longestStreak: 5 });

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption');

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentStreak: 5, longestStreak: 5 }),
        }),
      );
    });
  });

  describe('verification auto-approve scheduling', () => {
    it('enqueues the delayed auto-approval for the created completion after commit', async () => {
      stubHappyTransaction();

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption');

      expect(verificationQueue.enqueueAutoApprove).toHaveBeenCalledWith('completion-1');
    });

    it('does not enqueue when submission fails before the completion is created', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(precheckUser());
      prisma.completion.count.mockResolvedValue(1); // guest over the limit

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeDefined();
      expect(verificationQueue.enqueueAutoApprove).not.toHaveBeenCalled();
    });

    it('still returns the completion when enqueue fails (best-effort side effect)', async () => {
      stubHappyTransaction();
      verificationQueue.enqueueAutoApprove.mockRejectedValue(new Error('redis down'));

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-1' });
    });

    it('tolerates a non-Error enqueue rejection without a stack trace', async () => {
      stubHappyTransaction();
      verificationQueue.enqueueAutoApprove.mockRejectedValue('redis down');

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-1' });
    });
  });

  describe('referral completion hook (M20)', () => {
    it('fires the completion hook with the completing user after a completion', async () => {
      stubHappyTransaction();

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption');

      expect(referrals.recordCompletionIfQualifying).toHaveBeenCalledWith(USER_ID);
    });

    it('still returns the completion when the referral hook throws (best-effort)', async () => {
      stubHappyTransaction();
      referrals.recordCompletionIfQualifying.mockRejectedValue(new Error('referral db down'));

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-1' });
    });

    it('tolerates a non-Error referral-hook rejection without a stack trace', async () => {
      stubHappyTransaction();
      referrals.recordCompletionIfQualifying.mockRejectedValue('referral db down');

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-1' });
    });

    it('does not fire the hook when the completion fails before commit', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(precheckUser());
      prisma.completion.count.mockResolvedValue(1); // guest over the limit

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeDefined();
      expect(referrals.recordCompletionIfQualifying).not.toHaveBeenCalled();
    });
  });

  describe('idempotency guard (Decision 9 / M23.4)', () => {
    it('routes the submission through IdempotencyService with the supplied key and a mission-scoped endpoint', async () => {
      stubHappyTransaction();

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption', 'idem-key-1');

      expect(idempotency.run).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          key: 'idem-key-1',
          endpoint: `POST /missions/${MISSION_ID}/proof`,
        }),
      );
    });

    it('scopes two different missions to two different endpoint strings (regression: a reused key must not cross missions)', async () => {
      // An earlier version of this scope string was a bare, non-interpolated
      // literal — a client reusing one idempotency key across two different
      // missions would have the second mission's submission silently
      // short-circuited to the first mission's stored response. Interpolating
      // missionId is what makes that impossible: the two calls below hit
      // different (userId, key, endpoint) triples even with the same key.
      stubHappyTransaction();
      const otherMissionId = '22222222-2222-2222-2222-222222222222';

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption', 'shared-key');
      await service.submitProof(USER_ID, otherMissionId, undefined, 'caption', 'shared-key');

      const endpoints = idempotency.run.mock.calls.map((call) => call[0].endpoint);
      expect(endpoints).toEqual([
        `POST /missions/${MISSION_ID}/proof`,
        `POST /missions/${otherMissionId}/proof`,
      ]);
      expect(endpoints[0]).not.toBe(endpoints[1]);
    });

    it('passes an undefined key straight through (no-dedupe path) when none is supplied', async () => {
      stubHappyTransaction();

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption');

      expect(idempotency.run).toHaveBeenCalledWith(expect.objectContaining({ key: undefined }));
    });

    it('returns the stored response verbatim without re-executing on an idempotency hit', async () => {
      const stored = {
        completionId: 'stored-1',
        missionTitle: 'Cached',
        xpAwarded: 40,
        totalXp: 40,
        currentStreak: 1,
        longestStreak: 1,
        proofUrl: null,
      };
      idempotency.run.mockResolvedValueOnce(stored);

      const result = await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption', 'k');

      expect(result).toBe(stored);
      // The real write never ran — no mission lookup, no transaction.
      expect(prisma.mission.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
