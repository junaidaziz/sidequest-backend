import { Test, TestingModule } from '@nestjs/testing';
import { MediaPurpose } from '@prisma/client';
import { AuthUser } from '../auth/types/jwt-payload.interface';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

const AUTH_USER: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };

describe('MediaController', () => {
  let controller: MediaController;
  let service: {
    createUploadAuthorization: jest.Mock;
    confirmUpload: jest.Mock;
    getMedia: jest.Mock;
    deleteMedia: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createUploadAuthorization: jest.fn().mockResolvedValue({
        mediaId: 'media-1',
        uploadUrl: 'https://s3.example/put-url',
        objectKey: 'avatars/user-1/x.png',
        expiresAt: '2026-01-01T00:15:00.000Z',
      }),
      confirmUpload: jest
        .fn()
        .mockResolvedValue({ id: 'media-1', status: 'UPLOADED', variants: [] }),
      getMedia: jest.fn().mockResolvedValue({ id: 'media-1', status: 'READY', variants: [] }),
      deleteMedia: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: service }],
    }).compile();

    controller = moduleRef.get(MediaController);
  });

  it('createUpload forwards the caller id and request body to the service', async () => {
    const dto = {
      purpose: MediaPurpose.AVATAR,
      fileName: 'a.png',
      mimeType: 'image/png',
      fileSize: 1024,
    };

    const result = await controller.createUpload(AUTH_USER, dto);

    expect(service.createUploadAuthorization).toHaveBeenCalledWith('user-1', dto);
    expect(result.mediaId).toBe('media-1');
  });

  it('confirmUpload forwards the caller id and uploadId', async () => {
    const result = await controller.confirmUpload(AUTH_USER, 'media-1');

    expect(service.confirmUpload).toHaveBeenCalledWith('user-1', 'media-1');
    expect(result.status).toBe('UPLOADED');
  });

  it('getMedia forwards the caller id and mediaId', async () => {
    const result = await controller.getMedia(AUTH_USER, 'media-1');

    expect(service.getMedia).toHaveBeenCalledWith('user-1', 'media-1');
    expect(result.status).toBe('READY');
  });

  it('deleteMedia forwards the caller id and mediaId', async () => {
    await controller.deleteMedia(AUTH_USER, 'media-1');

    expect(service.deleteMedia).toHaveBeenCalledWith('user-1', 'media-1');
  });
});
