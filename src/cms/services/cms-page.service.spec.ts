import { BadRequestException } from '@nestjs/common';
import { CmsPage } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsCacheService } from './cms-cache.service';
import { CmsPageService } from './cms-page.service';
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

function makePage(overrides: Partial<CmsPage> = {}): CmsPage {
  const now = new Date();
  return {
    id: 'page-1',
    slug: 'about',
    title: 'About',
    body: { blocks: [] },
    metaTitle: null,
    metaDescription: null,
    status: 'Draft',
    publishedAt: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CmsPage;
}

describe('CmsPageService', () => {
  let delegate: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  let service: CmsPageService;

  beforeEach(() => {
    delegate = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
    const prisma = {
      cmsPage: delegate,
      $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
    } as unknown as PrismaService;
    service = new CmsPageService(
      prisma,
      {
        record: jest.fn().mockResolvedValue(undefined),
        buildRecord: jest.fn(() => Promise.resolve({})),
      } as unknown as AuditLogService,
      { invalidate: jest.fn().mockResolvedValue(undefined) } as unknown as CmsCacheService,
      { trigger: jest.fn() } as unknown as CmsRevalidationService,
    );
  });

  it('builds create data with a structured body', async () => {
    delegate.create.mockResolvedValue(makePage());
    await service.create(
      actor,
      { slug: 'about', title: 'About', body: { blocks: [{ kind: 'paragraph', text: 'hi' }] } },
      ctx,
    );
    const data = delegate.create.mock.calls[0][0].data;
    expect(data.slug).toBe('about');
    expect(data.body).toEqual({ blocks: [{ kind: 'paragraph', text: 'hi' }] });
    expect(data.metaTitle).toBeNull();
  });

  it('applies partial updates', async () => {
    delegate.findFirst.mockResolvedValue(makePage());
    delegate.update.mockResolvedValue(makePage({ title: 'New' }));
    await service.update(actor, 'page-1', { title: 'New', metaDescription: 'd' }, ctx);
    const data = delegate.update.mock.calls[0][0].data;
    expect(data).toEqual({ title: 'New', metaDescription: 'd', updatedByAdminId: 'admin-1' });
  });

  it('maps to an admin DTO', async () => {
    delegate.findFirst.mockResolvedValue(makePage({ status: 'Published' }));
    const dto = await service.get('page-1');
    expect(dto).toMatchObject({ slug: 'about', title: 'About', status: 'Published' });
  });

  it('is not reorderable (no sortOrder column)', async () => {
    await expect(service.reorder(actor, ['page-1'], ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
