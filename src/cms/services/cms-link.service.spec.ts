import { CmsLink, CmsLinkPlacement } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsCacheService } from './cms-cache.service';
import { CmsLinkService } from './cms-link.service';
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

function makeLink(overrides: Partial<CmsLink> = {}): CmsLink {
  const now = new Date();
  return {
    id: 'link-1',
    placement: CmsLinkPlacement.Footer,
    label: 'Privacy',
    url: '/privacy',
    sortOrder: 0,
    openInNewTab: false,
    status: 'Draft',
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CmsLink;
}

describe('CmsLinkService', () => {
  let delegate: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  let service: CmsLinkService;

  beforeEach(() => {
    delegate = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
    service = new CmsLinkService(
      { cmsLink: delegate } as unknown as PrismaService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      { invalidate: jest.fn().mockResolvedValue(undefined) } as unknown as CmsCacheService,
      { trigger: jest.fn() } as unknown as CmsRevalidationService,
    );
  });

  it('creates a link with defaults', async () => {
    delegate.create.mockResolvedValue(makeLink());
    await service.create(
      actor,
      { placement: CmsLinkPlacement.Footer, label: 'Privacy', url: '/privacy' },
      ctx,
    );
    const data = delegate.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ openInNewTab: false, sortOrder: 0, url: '/privacy' });
  });

  it('publishes WITHOUT stamping publishedAt (no such column)', async () => {
    delegate.findFirst.mockResolvedValue(makeLink());
    delegate.update.mockResolvedValue(makeLink({ status: 'Published' }));
    const dto = await service.setPublished(actor, 'link-1', true, ctx);
    const data = delegate.update.mock.calls[0][0].data;
    expect(data.status).toBe('Published');
    expect('publishedAt' in data).toBe(false);
    // DTO always exposes publishedAt as null for links.
    expect(dto.publishedAt).toBeNull();
  });

  it('updates selected fields', async () => {
    delegate.findFirst.mockResolvedValue(makeLink());
    delegate.update.mockResolvedValue(makeLink({ label: 'Terms' }));
    await service.update(actor, 'link-1', { label: 'Terms', openInNewTab: true }, ctx);
    const data = delegate.update.mock.calls[0][0].data;
    expect(data).toEqual({ label: 'Terms', openInNewTab: true, updatedByAdminId: 'admin-1' });
  });
});
