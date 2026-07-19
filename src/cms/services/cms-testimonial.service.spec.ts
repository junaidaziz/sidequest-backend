import { CmsTestimonial } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsRevalidationService } from './cms-revalidation.service';
import { CmsTestimonialService } from './cms-testimonial.service';
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

function makeT(overrides: Partial<CmsTestimonial> = {}): CmsTestimonial {
  const now = new Date();
  return {
    id: 't-1',
    authorName: 'Sam',
    authorTitle: null,
    quote: 'Great',
    avatarKey: null,
    rating: null,
    sortOrder: 0,
    status: 'Draft',
    publishedAt: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CmsTestimonial;
}

describe('CmsTestimonialService', () => {
  let delegate: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  let assets: { store: jest.Mock; resolveUrl: jest.Mock; remove: jest.Mock };
  let service: CmsTestimonialService;

  beforeEach(() => {
    delegate = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
    assets = {
      store: jest.fn().mockResolvedValue('cms/testimonials/new.png'),
      resolveUrl: jest.fn().mockResolvedValue('https://signed/x'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    service = new CmsTestimonialService(
      {
        cmsTestimonial: delegate,
        $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
      } as unknown as PrismaService,
      {
        record: jest.fn().mockResolvedValue(undefined),
        buildRecord: jest.fn(() => Promise.resolve({})),
      } as unknown as AuditLogService,
      { invalidate: jest.fn().mockResolvedValue(undefined) } as unknown as CmsCacheService,
      { trigger: jest.fn() } as unknown as CmsRevalidationService,
      assets as unknown as CmsAssetService,
    );
  });

  it('resolves the avatar URL in the admin DTO', async () => {
    delegate.findFirst.mockResolvedValue(makeT({ avatarKey: 'cms/testimonials/old.png' }));
    const dto = await service.get('t-1');
    expect(dto.avatarUrl).toBe('https://signed/x');
    expect(assets.resolveUrl).toHaveBeenCalledWith('cms/testimonials/old.png');
  });

  it('sets a new avatar and cleans up the previous object', async () => {
    delegate.findFirst.mockResolvedValue(makeT({ avatarKey: 'cms/testimonials/old.png' }));
    delegate.update.mockResolvedValue(makeT({ avatarKey: 'cms/testimonials/new.png' }));
    const file = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;
    await service.setAvatar(actor, 't-1', file, ctx);
    expect(assets.store).toHaveBeenCalledWith('testimonials', file);
    expect(delegate.update.mock.calls[0][0].data.avatarKey).toBe('cms/testimonials/new.png');
    expect(assets.remove).toHaveBeenCalledWith('cms/testimonials/old.png');
  });

  it('does not attempt cleanup when there was no prior avatar', async () => {
    delegate.findFirst.mockResolvedValue(makeT({ avatarKey: null }));
    delegate.update.mockResolvedValue(makeT({ avatarKey: 'cms/testimonials/new.png' }));
    const file = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;
    await service.setAvatar(actor, 't-1', file, ctx);
    expect(assets.remove).not.toHaveBeenCalled();
  });

  it('builds create + update data', async () => {
    delegate.create.mockResolvedValue(makeT());
    await service.create(actor, { authorName: 'Sam', quote: 'Great', rating: 5 }, ctx);
    expect(delegate.create.mock.calls[0][0].data).toMatchObject({
      authorName: 'Sam',
      quote: 'Great',
      rating: 5,
    });
    delegate.findFirst.mockResolvedValue(makeT());
    delegate.update.mockResolvedValue(makeT({ quote: 'Updated' }));
    await service.update(actor, 't-1', { quote: 'Updated' }, ctx);
    expect(delegate.update.mock.calls[0][0].data).toEqual({
      quote: 'Updated',
      updatedByAdminId: 'admin-1',
    });
  });
});
