import { BadRequestException } from '@nestjs/common';
import { CmsScreenshot } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsRevalidationService } from './cms-revalidation.service';
import { CmsScreenshotService } from './cms-screenshot.service';
import { CmsRequestContext } from '../types/cms.types';

const actor: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'a@x.com',
  roleId: 'r',
  sessionId: 's',
  mfaPending: false,
  mustChangePassword: false,
};
const ctx: CmsRequestContext = { ipAddress: null, userAgent: null };
const file = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;

function makeS(overrides: Partial<CmsScreenshot> = {}): CmsScreenshot {
  const now = new Date();
  return {
    id: 's-1',
    title: null,
    caption: null,
    imageKey: 'cms/screenshots/a.png',
    sortOrder: 0,
    status: 'Draft',
    publishedAt: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CmsScreenshot;
}

describe('CmsScreenshotService', () => {
  let delegate: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  let assets: { store: jest.Mock; resolveUrl: jest.Mock; remove: jest.Mock };
  let service: CmsScreenshotService;

  beforeEach(() => {
    delegate = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
    assets = {
      store: jest.fn().mockResolvedValue('cms/screenshots/new.png'),
      resolveUrl: jest.fn().mockResolvedValue('https://signed/x'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    service = new CmsScreenshotService(
      { cmsScreenshot: delegate } as unknown as PrismaService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      { invalidate: jest.fn().mockResolvedValue(undefined) } as unknown as CmsCacheService,
      { trigger: jest.fn() } as unknown as CmsRevalidationService,
      assets as unknown as CmsAssetService,
    );
  });

  it('creates a screenshot from an uploaded image', async () => {
    delegate.create.mockResolvedValue(makeS({ imageKey: 'cms/screenshots/new.png' }));
    const dto = await service.createWithImage(actor, { title: 'Home', sortOrder: 2 }, file, ctx);
    expect(assets.store).toHaveBeenCalledWith('screenshots', file);
    expect(delegate.create.mock.calls[0][0].data).toMatchObject({
      title: 'Home',
      imageKey: 'cms/screenshots/new.png',
      sortOrder: 2,
    });
    expect(dto.imageUrl).toBe('https://signed/x');
  });

  it('rejects a plain JSON create (image is mandatory)', async () => {
    await expect(service.create(actor, { title: 'x' }, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('replaces the image and cleans up the old object', async () => {
    delegate.findFirst.mockResolvedValue(makeS({ imageKey: 'cms/screenshots/old.png' }));
    delegate.update.mockResolvedValue(makeS({ imageKey: 'cms/screenshots/new.png' }));
    await service.replaceImage(actor, 's-1', file, ctx);
    expect(delegate.update.mock.calls[0][0].data.imageKey).toBe('cms/screenshots/new.png');
    expect(assets.remove).toHaveBeenCalledWith('cms/screenshots/old.png');
  });

  it('updates metadata only', async () => {
    delegate.findFirst.mockResolvedValue(makeS());
    delegate.update.mockResolvedValue(makeS({ caption: 'Cap' }));
    await service.update(actor, 's-1', { caption: 'Cap' }, ctx);
    expect(delegate.update.mock.calls[0][0].data).toEqual({
      caption: 'Cap',
      updatedByAdminId: 'admin-1',
    });
  });
});
