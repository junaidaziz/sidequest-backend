import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from '../storage/storage.service';
import { MediaUrlService } from './media-url.service';
import { MEDIA_CDN_DOMAIN_ENV } from './media.constants';

describe('MediaUrlService', () => {
  let storage: { getSignedDownloadUrl: jest.Mock };

  async function build(cdnDomain: string | undefined): Promise<MediaUrlService> {
    storage = {
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/key'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaUrlService,
        { provide: StorageService, useValue: storage },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === MEDIA_CDN_DOMAIN_ENV ? cdnDomain : undefined),
          },
        },
      ],
    }).compile();
    return module.get(MediaUrlService);
  }

  it('resolves to a presigned GET URL when no CDN domain is configured', async () => {
    const service = await build(undefined);

    const url = await service.resolve('avatars/user-1/pic.jpg');

    expect(url).toBe('https://signed.example/key');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('avatars/user-1/pic.jpg');
    expect(service.usingCdn).toBe(false);
  });

  it('resolves to a stable CDN URL when a CDN domain is configured', async () => {
    const service = await build('media.sidequest.app');

    const url = await service.resolve('avatars/user-1/pic.jpg');

    expect(url).toBe('https://media.sidequest.app/avatars/user-1/pic.jpg');
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(service.usingCdn).toBe(true);
  });
});
