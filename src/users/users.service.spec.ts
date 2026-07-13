import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from './users.service';

const USER_ID = 'user-1';

const PROFILE: UserProfileDto = {
  id: USER_ID,
  email: 'ada@example.com',
  displayName: 'Ada',
  isGuest: false,
  avatarUrl: 'https://signed.example/avatar',
};

function pngFile(): Express.Multer.File {
  return { mimetype: 'image/png', buffer: Buffer.from('bytes') } as Express.Multer.File;
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let storage: {
    buildAvatarKey: jest.Mock;
    uploadObject: jest.Mock;
    deleteObject: jest.Mock;
  };
  let authService: { getProfile: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    storage = {
      buildAvatarKey: jest.fn().mockReturnValue('avatars/user-1/new.png'),
      uploadObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    authService = { getProfile: jest.fn().mockResolvedValue(PROFILE) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('uploadAvatar', () => {
    it('uploads the file, points avatarUrl at the new key, and returns the profile', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: null });

      const result = await service.uploadAvatar(USER_ID, pngFile());

      expect(storage.buildAvatarKey).toHaveBeenCalledWith(USER_ID, 'image/png');
      expect(storage.uploadObject).toHaveBeenCalledWith(
        'avatars/user-1/new.png',
        expect.any(Buffer),
        'image/png',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { avatarUrl: 'avatars/user-1/new.png' },
      });
      // No prior avatar => nothing to clean up.
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(result).toEqual(PROFILE);
    });

    it('deletes the previous avatar object after the replacement upload succeeds', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'avatars/user-1/old.png' });

      await service.uploadAvatar(USER_ID, pngFile());

      expect(storage.deleteObject).toHaveBeenCalledWith('avatars/user-1/old.png');
      // Cleanup happens only after upload + DB pointer update.
      const uploadOrder = storage.uploadObject.mock.invocationCallOrder[0];
      const updateOrder = prisma.user.update.mock.invocationCallOrder[0];
      const deleteOrder = storage.deleteObject.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeGreaterThan(uploadOrder);
      expect(deleteOrder).toBeGreaterThan(updateOrder);
    });

    it('swallows a cleanup failure for the replaced object and still returns the profile', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'avatars/user-1/old.png' });
      storage.deleteObject.mockRejectedValue(new Error('S3 down'));

      const result = await service.uploadAvatar(USER_ID, pngFile());

      expect(result).toEqual(PROFILE);
    });

    it('swallows a non-Error cleanup rejection for the replaced object', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'avatars/user-1/old.png' });
      storage.deleteObject.mockRejectedValue('string failure');

      const result = await service.uploadAvatar(USER_ID, pngFile());

      expect(result).toEqual(PROFILE);
    });

    it('propagates a 400 for an unsupported image type without uploading', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: null });
      storage.buildAvatarKey.mockImplementation(() => {
        throw new BadRequestException('UNSUPPORTED_IMAGE_TYPE');
      });

      await expect(service.uploadAvatar(USER_ID, pngFile())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.uploadObject).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user row is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.uploadAvatar(USER_ID, pngFile())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.uploadObject).not.toHaveBeenCalled();
    });
  });

  describe('deleteAvatar', () => {
    it('deletes the object and nulls avatarUrl when an avatar exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'avatars/user-1/pic.png' });

      const result = await service.deleteAvatar(USER_ID);

      expect(storage.deleteObject).toHaveBeenCalledWith('avatars/user-1/pic.png');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { avatarUrl: null },
      });
      expect(result).toEqual(PROFILE);
    });

    it('is a no-op success when no avatar is set (idempotent)', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: null });

      const result = await service.deleteAvatar(USER_ID);

      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result).toEqual(PROFILE);
    });

    it('still nulls the pointer when the S3 delete fails', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'avatars/user-1/pic.png' });
      storage.deleteObject.mockRejectedValue(new Error('S3 down'));

      const result = await service.deleteAvatar(USER_ID);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { avatarUrl: null },
      });
      expect(result).toEqual(PROFILE);
    });

    it('still nulls the pointer when the S3 delete rejects with a non-Error value', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarUrl: 'avatars/user-1/pic.png' });
      storage.deleteObject.mockRejectedValue('string failure');

      const result = await service.deleteAvatar(USER_ID);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { avatarUrl: null },
      });
      expect(result).toEqual(PROFILE);
    });

    it('throws NotFoundException when the user row is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteAvatar(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
