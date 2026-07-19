import { CmsAnnouncement, CmsAnnouncementKind } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsAnnouncementService } from './cms-announcement.service';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsRevalidationService } from './cms-revalidation.service';
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

function makeA(overrides: Partial<CmsAnnouncement> = {}): CmsAnnouncement {
  const now = new Date();
  return {
    id: 'a-1',
    kind: CmsAnnouncementKind.Blog,
    slug: 'launch',
    title: 'We launched',
    excerpt: null,
    body: { blocks: [] },
    coverImageKey: null,
    status: 'Draft',
    publishedAt: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CmsAnnouncement;
}

describe('CmsAnnouncementService', () => {
  let delegate: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  let assets: { store: jest.Mock; resolveUrl: jest.Mock; remove: jest.Mock };
  let service: CmsAnnouncementService;

  beforeEach(() => {
    delegate = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
    assets = {
      store: jest.fn().mockResolvedValue('cms/announcements/new.png'),
      resolveUrl: jest.fn().mockResolvedValue('https://signed/x'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    service = new CmsAnnouncementService(
      {
        cmsAnnouncement: delegate,
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

  it('creates with kind/slug/body', async () => {
    delegate.create.mockResolvedValue(makeA());
    await service.create(
      actor,
      {
        kind: CmsAnnouncementKind.Blog,
        slug: 'launch',
        title: 'We launched',
        body: { blocks: [{ kind: 'paragraph', text: 'hi' }] },
      },
      ctx,
    );
    expect(delegate.create.mock.calls[0][0].data).toMatchObject({
      kind: 'Blog',
      slug: 'launch',
    });
  });

  it('sets a cover image and cleans up the previous one', async () => {
    delegate.findFirst.mockResolvedValue(makeA({ coverImageKey: 'cms/announcements/old.png' }));
    delegate.update.mockResolvedValue(makeA({ coverImageKey: 'cms/announcements/new.png' }));
    const file = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;
    const dto = await service.setCover(actor, 'a-1', file, ctx);
    expect(delegate.update.mock.calls[0][0].data.coverImageKey).toBe('cms/announcements/new.png');
    expect(assets.remove).toHaveBeenCalledWith('cms/announcements/old.png');
    expect(dto.coverImageUrl).toBe('https://signed/x');
  });

  it('updates selected fields', async () => {
    delegate.findFirst.mockResolvedValue(makeA());
    delegate.update.mockResolvedValue(makeA({ title: 'New' }));
    await service.update(actor, 'a-1', { title: 'New', excerpt: 'e' }, ctx);
    expect(delegate.update.mock.calls[0][0].data).toEqual({
      title: 'New',
      excerpt: 'e',
      updatedByAdminId: 'admin-1',
    });
  });
});
