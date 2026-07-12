import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProofType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ProofService } from './proof.service';

interface PrismaMock {
  mission: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock; update: jest.Mock };
  completion: { count: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
}

interface StorageMock {
  buildProofKey: jest.Mock;
  uploadObject: jest.Mock;
  getSignedDownloadUrl: jest.Mock;
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

function guestUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    isGuest: true,
    currentStreak: 0,
    longestStreak: 0,
    lastCompletionDate: null,
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
  let storage: StorageMock;

  beforeEach(async () => {
    prisma = {
      mission: { findUnique: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      completion: { count: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    storage = {
      buildProofKey: jest.fn(),
      uploadObject: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ProofService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(ProofService);
  });

  /** Wires the mocks for a successful completion so happy-path tests stay terse. */
  function stubHappyTransaction(): void {
    prisma.mission.findUnique.mockResolvedValue(activeMission());
    prisma.user.findUnique.mockResolvedValue(guestUser());
    prisma.completion.count.mockResolvedValue(0);
    prisma.completion.create.mockReturnValue('create-op');
    prisma.user.update.mockReturnValue('update-op');
    prisma.$transaction.mockResolvedValue([
      { id: 'completion-1', xpAwarded: 40 },
      { totalXp: 40, currentStreak: 1, longestStreak: 1 },
    ]);
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
      prisma.mission.findUnique.mockResolvedValue(activeMission());
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

  describe('guest gate', () => {
    it('allows a guest with 0 prior completions', async () => {
      stubHappyTransaction();
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-1' });
      expect(prisma.completion.count).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    });

    it('rejects a guest with 1+ prior completions with the exact reason string', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(guestUser());
      prisma.completion.count.mockResolvedValue(1);

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toMatchObject({
        message: 'GUEST_COMPLETION_LIMIT_REACHED',
      });
      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not apply the completion limit to a signed-in (non-guest) user', async () => {
      prisma.mission.findUnique.mockResolvedValue(activeMission());
      prisma.user.findUnique.mockResolvedValue(guestUser({ isGuest: false, totalXp: 500 }));
      prisma.completion.create.mockReturnValue('create-op');
      prisma.user.update.mockReturnValue('update-op');
      prisma.$transaction.mockResolvedValue([
        { id: 'completion-9', xpAwarded: 40 },
        { totalXp: 540, currentStreak: 1, longestStreak: 1 },
      ]);

      await expect(
        service.submitProof(USER_ID, MISSION_ID, undefined, 'caption'),
      ).resolves.toMatchObject({ completionId: 'completion-9' });
      // The guest count query is skipped entirely for non-guests.
      expect(prisma.completion.count).not.toHaveBeenCalled();
    });
  });

  describe('text proof', () => {
    it('stores the caption, awards XP, and returns no proofUrl', async () => {
      stubHappyTransaction();

      const result = await service.submitProof(USER_ID, MISSION_ID, undefined, 'Found it!');

      expect(storage.uploadObject).not.toHaveBeenCalled();
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
      expect(prisma.completion.create).toHaveBeenCalledWith(
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
    it('uploads the photo, stores the key, and returns a presigned proofUrl', async () => {
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
      expect(prisma.completion.create).toHaveBeenCalledWith(
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
      prisma.user.findUnique.mockResolvedValue(guestUser());
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
    it('increments XP and sets the fresh-streak fields inside a single $transaction', async () => {
      stubHappyTransaction();

      await service.submitProof(USER_ID, MISSION_ID, undefined, 'caption');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(['create-op', 'update-op']);
      expect(prisma.user.update).toHaveBeenCalledWith(
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
  });
});
