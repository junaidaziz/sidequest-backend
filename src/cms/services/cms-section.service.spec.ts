import { CmsSection, CmsSectionType } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsCacheService } from './cms-cache.service';
import { CmsSectionService } from './cms-section.service';
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

function makeSection(overrides: Partial<CmsSection> = {}): CmsSection {
  const now = new Date();
  return {
    id: 'sec-1',
    key: 'home.hero',
    type: CmsSectionType.Hero,
    title: null,
    data: { headline: 'Hi' },
    sortOrder: 0,
    status: 'Draft',
    publishedAt: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CmsSection;
}

describe('CmsSectionService', () => {
  let delegate: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  let service: CmsSectionService;

  beforeEach(() => {
    delegate = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
    service = new CmsSectionService(
      { cmsSection: delegate } as unknown as PrismaService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      { invalidate: jest.fn().mockResolvedValue(undefined) } as unknown as CmsCacheService,
      { trigger: jest.fn() } as unknown as CmsRevalidationService,
    );
  });

  it('creates with the validated data payload', async () => {
    delegate.create.mockResolvedValue(makeSection());
    await service.create(
      actor,
      { key: 'home.hero', type: CmsSectionType.Hero, data: { headline: 'Hi' } },
      ctx,
    );
    const data = delegate.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      key: 'home.hero',
      type: 'Hero',
      data: { headline: 'Hi' },
      sortOrder: 0,
    });
  });

  it('updates key/type/data/sortOrder selectively', async () => {
    delegate.findFirst.mockResolvedValue(makeSection());
    delegate.update.mockResolvedValue(makeSection({ sortOrder: 3 }));
    await service.update(actor, 'sec-1', { sortOrder: 3, title: 'T' }, ctx);
    const data = delegate.update.mock.calls[0][0].data;
    expect(data).toEqual({ sortOrder: 3, title: 'T', updatedByAdminId: 'admin-1' });
  });

  it('maps to an admin DTO including type + data', async () => {
    delegate.findFirst.mockResolvedValue(makeSection());
    const dto = await service.get('sec-1');
    expect(dto).toMatchObject({ key: 'home.hero', type: 'Hero', data: { headline: 'Hi' } });
  });
});
