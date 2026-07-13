import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const AUTH_USER: AuthUser = {
  userId: 'user-1',
  email: 'ada@example.com',
  isGuest: false,
};

const PROFILE: UserProfileDto = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  isGuest: false,
  avatarUrl: 'https://signed.example/avatar',
};

describe('UsersController', () => {
  let controller: UsersController;
  let service: { uploadAvatar: jest.Mock; deleteAvatar: jest.Mock };

  beforeEach(async () => {
    service = {
      uploadAvatar: jest.fn().mockResolvedValue(PROFILE),
      deleteAvatar: jest.fn().mockResolvedValue({ ...PROFILE, avatarUrl: null }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = moduleRef.get(UsersController);
  });

  describe('uploadAvatar', () => {
    it('forwards the uploaded file to the service and returns the profile', async () => {
      const avatar = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;

      const result = await controller.uploadAvatar(AUTH_USER, avatar);

      expect(service.uploadAvatar).toHaveBeenCalledWith('user-1', avatar);
      expect(result).toEqual(PROFILE);
    });

    it('rejects a request with no file with a 400 before hitting the service', () => {
      expect(() => controller.uploadAvatar(AUTH_USER, undefined)).toThrow(BadRequestException);
      expect(service.uploadAvatar).not.toHaveBeenCalled();
    });
  });

  describe('deleteAvatar', () => {
    it('delegates to the service and returns the avatar-less profile', async () => {
      const result = await controller.deleteAvatar(AUTH_USER);

      expect(service.deleteAvatar).toHaveBeenCalledWith('user-1');
      expect(result.avatarUrl).toBeNull();
    });
  });
});
