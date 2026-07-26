import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaPurpose, MediaStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaProcessingQueueService } from './media-processing-queue.service';
import { MediaUrlService } from './media-url.service';
import { MediaService } from './media.service';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const MEDIA_ID = 'media-1';
const MISSION_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = '22222222-2222-2222-2222-222222222222';

function build(): {
  service: MediaService;
  prisma: {
    mediaAsset: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    mediaVariant: { findMany: jest.Mock };
    mission: { findUnique: jest.Mock };
    userTask: { findUnique: jest.Mock };
  };
  storage: {
    getSignedUploadUrl: jest.Mock;
    headObject: jest.Mock;
    deleteObject: jest.Mock;
    buildAvatarKey: jest.Mock;
    buildProofKey: jest.Mock;
    buildTaskAttachmentKey: jest.Mock;
  };
  mediaUrl: { resolve: jest.Mock };
  queue: { enqueueGenerateVariants: jest.Mock };
} {
  const prisma = {
    mediaAsset: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    mediaVariant: { findMany: jest.fn().mockResolvedValue([]) },
    mission: { findUnique: jest.fn() },
    userTask: { findUnique: jest.fn() },
  };
  const storage = {
    getSignedUploadUrl: jest.fn().mockResolvedValue('https://s3.example/put-url'),
    headObject: jest.fn(),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    buildAvatarKey: jest.fn((userId: string) => `avatars/${userId}/generated.png`),
    buildProofKey: jest.fn((userId: string) => `proofs/${userId}/generated.jpg`),
    buildTaskAttachmentKey: jest.fn((userId: string) => `task-attachments/${userId}/generated.jpg`),
  };
  const mediaUrl = { resolve: jest.fn().mockResolvedValue('https://cdn.example/key') };
  const queue = { enqueueGenerateVariants: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(undefined) };

  const service = new MediaService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    mediaUrl as unknown as MediaUrlService,
    queue as unknown as MediaProcessingQueueService,
    config as unknown as ConfigService,
  );

  return { service, prisma, storage, mediaUrl, queue };
}

describe('MediaService', () => {
  describe('createUploadAuthorization', () => {
    it('rejects an unsupported MIME type before touching the DB', async () => {
      const { service, prisma } = build();

      await expect(
        service.createUploadAuthorization(USER_ID, {
          purpose: MediaPurpose.AVATAR,
          fileName: 'a.gif',
          mimeType: 'image/gif',
          fileSize: 1024,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
    });

    it('rejects a declared fileSize over the purpose cap', async () => {
      const { service, prisma } = build();

      await expect(
        service.createUploadAuthorization(USER_ID, {
          purpose: MediaPurpose.AVATAR,
          fileName: 'a.png',
          mimeType: 'image/png',
          fileSize: 999_999_999,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
    });

    it('rejects a relatedEntityId supplied for AVATAR', async () => {
      const { service } = build();

      await expect(
        service.createUploadAuthorization(USER_ID, {
          purpose: MediaPurpose.AVATAR,
          fileName: 'a.png',
          mimeType: 'image/png',
          fileSize: 1024,
          relatedEntityId: MISSION_ID,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a PENDING_UPLOAD asset and returns a presigned PUT URL for a valid AVATAR request', async () => {
      const { service, prisma, storage } = build();
      prisma.mediaAsset.create.mockResolvedValue({ id: MEDIA_ID });

      const result = await service.createUploadAuthorization(USER_ID, {
        purpose: MediaPurpose.AVATAR,
        fileName: 'a.png',
        mimeType: 'image/png',
        fileSize: 1024,
      });

      expect(prisma.mediaAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: USER_ID,
            purpose: MediaPurpose.AVATAR,
            relatedEntityId: null,
            status: MediaStatus.PENDING_UPLOAD,
          }),
        }),
      );
      expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^avatars\/user-1\//),
        'image/png',
        expect.any(Number),
      );
      expect(result).toEqual(
        expect.objectContaining({
          mediaId: MEDIA_ID,
          uploadUrl: 'https://s3.example/put-url',
          requiredHeaders: { 'Content-Type': 'image/png' },
        }),
      );
    });

    it('requires a relatedEntityId for PROOF and authorizes it against a real, active mission', async () => {
      const { service, prisma } = build();
      prisma.mission.findUnique.mockResolvedValue({ id: MISSION_ID, isActive: true });
      prisma.mediaAsset.create.mockResolvedValue({ id: MEDIA_ID });

      await service.createUploadAuthorization(USER_ID, {
        purpose: MediaPurpose.PROOF,
        fileName: 'p.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
        relatedEntityId: MISSION_ID,
      });

      expect(prisma.mission.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: MISSION_ID } }),
      );
    });

    it('rejects PROOF with no relatedEntityId', async () => {
      const { service } = build();

      await expect(
        service.createUploadAuthorization(USER_ID, {
          purpose: MediaPurpose.PROOF,
          fileName: 'p.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects PROOF referencing a mission that does not exist', async () => {
      const { service, prisma } = build();
      prisma.mission.findUnique.mockResolvedValue(null);

      await expect(
        service.createUploadAuthorization(USER_ID, {
          purpose: MediaPurpose.PROOF,
          fileName: 'p.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024,
          relatedEntityId: MISSION_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('authorizes TASK_ATTACHMENT when the caller is the task creator or assignee', async () => {
      const { service, prisma } = build();
      prisma.userTask.findUnique.mockResolvedValue({ creatorId: USER_ID, assigneeId: null });
      prisma.mediaAsset.create.mockResolvedValue({ id: MEDIA_ID });

      await service.createUploadAuthorization(USER_ID, {
        purpose: MediaPurpose.TASK_ATTACHMENT,
        fileName: 't.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
        relatedEntityId: TASK_ID,
      });

      expect(prisma.userTask.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TASK_ID } }),
      );
    });

    it('rejects TASK_ATTACHMENT when the caller is neither creator nor assignee', async () => {
      const { service, prisma } = build();
      prisma.userTask.findUnique.mockResolvedValue({
        creatorId: OTHER_USER_ID,
        assigneeId: 'user-3',
      });

      await expect(
        service.createUploadAuthorization(USER_ID, {
          purpose: MediaPurpose.TASK_ATTACHMENT,
          fileName: 't.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024,
          relatedEntityId: TASK_ID,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects TASK_ATTACHMENT referencing a task that does not exist', async () => {
      const { service, prisma } = build();
      prisma.userTask.findUnique.mockResolvedValue(null);

      await expect(
        service.createUploadAuthorization(USER_ID, {
          purpose: MediaPurpose.TASK_ATTACHMENT,
          fileName: 't.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024,
          relatedEntityId: TASK_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('confirmUpload', () => {
    function pendingAsset(overrides: Record<string, unknown> = {}) {
      return {
        id: MEDIA_ID,
        ownerId: USER_ID,
        purpose: MediaPurpose.AVATAR,
        status: MediaStatus.PENDING_UPLOAD,
        originalKey: 'avatars/user-1/x.png',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
      };
    }

    it('confirms a real uploaded object and queues variant generation', async () => {
      const { service, prisma, storage, queue } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue(pendingAsset());
      storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/png' });
      prisma.mediaAsset.update.mockResolvedValue(pendingAsset({ status: MediaStatus.UPLOADED }));

      const result = await service.confirmUpload(USER_ID, MEDIA_ID);

      expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MediaStatus.UPLOADED }),
        }),
      );
      expect(queue.enqueueGenerateVariants).toHaveBeenCalledWith(MEDIA_ID);
      expect(result.status).toBe(MediaStatus.UPLOADED);
    });

    it('rejects when no object exists at the authorized key', async () => {
      const { service, prisma, storage, queue } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue(pendingAsset());
      storage.headObject.mockResolvedValue(null);

      await expect(service.confirmUpload(USER_ID, MEDIA_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(queue.enqueueGenerateVariants).not.toHaveBeenCalled();
    });

    it('fails the asset and deletes the object when the real upload exceeds the size cap', async () => {
      const { service, prisma, storage, queue } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue(pendingAsset());
      storage.headObject.mockResolvedValue({ size: 999_999_999, contentType: 'image/png' });

      await expect(service.confirmUpload(USER_ID, MEDIA_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.deleteObject).toHaveBeenCalledWith('avatars/user-1/x.png');
      expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MediaStatus.FAILED }),
        }),
      );
      expect(queue.enqueueGenerateVariants).not.toHaveBeenCalled();
    });

    it('is idempotent — a retried confirm on an already-past-pending asset just returns the current state', async () => {
      const { service, prisma, storage, queue } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue(pendingAsset({ status: MediaStatus.READY }));

      const result = await service.confirmUpload(USER_ID, MEDIA_ID);

      expect(storage.headObject).not.toHaveBeenCalled();
      expect(queue.enqueueGenerateVariants).not.toHaveBeenCalled();
      expect(result.status).toBe(MediaStatus.READY);
    });

    it('throws NotFoundException for a non-owned media id', async () => {
      const { service, prisma } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue(pendingAsset({ ownerId: OTHER_USER_ID }));

      await expect(service.confirmUpload(USER_ID, MEDIA_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getMedia / deleteMedia', () => {
    it('getMedia returns a projected asset with resolved variant URLs', async () => {
      const { service, prisma, mediaUrl } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue({
        id: MEDIA_ID,
        ownerId: USER_ID,
        purpose: MediaPurpose.AVATAR,
        status: MediaStatus.READY,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      prisma.mediaVariant.findMany.mockResolvedValue([
        {
          name: 'md',
          objectKey: 'avatars/user-1/x/md.webp',
          width: 240,
          height: 240,
          format: 'webp',
        },
      ]);

      const result = await service.getMedia(USER_ID, MEDIA_ID);

      expect(mediaUrl.resolve).toHaveBeenCalledWith('avatars/user-1/x/md.webp');
      expect(result.variants).toEqual([
        { name: 'md', url: 'https://cdn.example/key', width: 240, height: 240, format: 'webp' },
      ]);
    });

    it('getMedia throws NotFoundException for a non-owned asset (not 403)', async () => {
      const { service, prisma } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue({ id: MEDIA_ID, ownerId: OTHER_USER_ID });

      await expect(service.getMedia(USER_ID, MEDIA_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getMedia throws NotFoundException for a missing asset', async () => {
      const { service, prisma } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue(null);

      await expect(service.getMedia(USER_ID, MEDIA_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deleteMedia best-effort deletes every object (original + variants) then the row', async () => {
      const { service, prisma, storage } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue({
        id: MEDIA_ID,
        ownerId: USER_ID,
        originalKey: 'avatars/user-1/x.png',
      });
      prisma.mediaVariant.findMany.mockResolvedValue([
        { objectKey: 'avatars/user-1/x/md.webp' },
        { objectKey: 'avatars/user-1/x/lg.webp' },
      ]);

      await service.deleteMedia(USER_ID, MEDIA_ID);

      expect(storage.deleteObject).toHaveBeenCalledWith('avatars/user-1/x.png');
      expect(storage.deleteObject).toHaveBeenCalledWith('avatars/user-1/x/md.webp');
      expect(storage.deleteObject).toHaveBeenCalledWith('avatars/user-1/x/lg.webp');
      expect(prisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: MEDIA_ID } });
    });

    it('deleteMedia swallows a storage cleanup failure and still deletes the row', async () => {
      const { service, prisma, storage } = build();
      prisma.mediaAsset.findUnique.mockResolvedValue({
        id: MEDIA_ID,
        ownerId: USER_ID,
        originalKey: 'avatars/user-1/x.png',
      });
      storage.deleteObject.mockRejectedValue(new Error('S3 down'));

      await service.deleteMedia(USER_ID, MEDIA_ID);

      expect(prisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: MEDIA_ID } });
    });
  });

  describe('resolveVariantsForAsset', () => {
    it('resolves delivery URLs for every variant of an asset', async () => {
      const { service, prisma, mediaUrl } = build();
      prisma.mediaVariant.findMany.mockResolvedValue([
        {
          name: 'sm',
          objectKey: 'avatars/user-1/x/sm.webp',
          width: 150,
          height: 150,
          format: 'webp',
        },
      ]);

      const result = await service.resolveVariantsForAsset(MEDIA_ID);

      expect(mediaUrl.resolve).toHaveBeenCalledWith('avatars/user-1/x/sm.webp');
      expect(result).toEqual([
        { name: 'sm', url: 'https://cdn.example/key', width: 150, height: 150, format: 'webp' },
      ]);
    });
  });
});
