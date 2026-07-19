import { BadRequestException } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { CmsAssetService } from './cms-asset.service';

type StorageMock = {
  buildCmsAssetKey: jest.Mock;
  uploadObject: jest.Mock;
  getSignedDownloadUrl: jest.Mock;
  deleteObject: jest.Mock;
};

function makeStorage(): StorageMock {
  return {
    buildCmsAssetKey: jest.fn((prefix: string) => `cms/${prefix}/uuid.png`),
    uploadObject: jest.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed/x'),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
}

function file(mimetype: string, body: string): Express.Multer.File {
  return { mimetype, buffer: Buffer.from(body, 'utf8') } as Express.Multer.File;
}

describe('CmsAssetService', () => {
  let storage: StorageMock;
  let service: CmsAssetService;

  beforeEach(() => {
    storage = makeStorage();
    service = new CmsAssetService(storage as unknown as StorageService);
  });

  it('rejects a non-CMS-image mime type', async () => {
    await expect(service.store('screenshots', file('application/pdf', 'x'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.uploadObject).not.toHaveBeenCalled();
  });

  it('stores a raster image as-is', async () => {
    const key = await service.store('screenshots', file('image/png', 'rawbytes'));
    expect(key).toBe('cms/screenshots/uuid.png');
    const [, body, contentType] = storage.uploadObject.mock.calls[0];
    expect(body.toString('utf8')).toBe('rawbytes');
    expect(contentType).toBe('image/png');
  });

  it('sanitizes an SVG before storing it', async () => {
    storage.buildCmsAssetKey.mockReturnValue('cms/testimonials/uuid.svg');
    const svg = '<svg><script>alert(1)</script><rect/></svg>';
    await service.store('testimonials', file('image/svg+xml', svg));
    const [, body] = storage.uploadObject.mock.calls[0];
    const stored = body.toString('utf8');
    expect(stored).not.toContain('<script');
    expect(stored).not.toContain('alert(1)');
    expect(stored).toContain('<rect');
  });

  it('resolves and removes keys, tolerating null', async () => {
    expect(await service.resolveUrl(null)).toBeNull();
    expect(await service.resolveUrl('k')).toBe('https://signed/x');
    await service.remove(null);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    await service.remove('k');
    expect(storage.deleteObject).toHaveBeenCalledWith('k');
  });
});
