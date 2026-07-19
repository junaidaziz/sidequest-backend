import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CmsFaq, Prisma } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsCacheService } from './cms-cache.service';
import { CmsFaqService } from './cms-faq.service';
import { CmsRevalidationService } from './cms-revalidation.service';
import { CmsRequestContext } from '../types/cms.types';

const actor: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'a@x.com',
  roleId: 'role-1',
  sessionId: 'sess-1',
  mfaPending: false,
  mustChangePassword: false,
};
const ctx: CmsRequestContext = { ipAddress: '1.1.1.1', userAgent: 'jest' };

function makeFaq(overrides: Partial<CmsFaq> = {}): CmsFaq {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'faq-1',
    question: 'Q?',
    answer: 'A',
    category: null,
    sortOrder: 0,
    status: 'Draft',
    publishedAt: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as CmsFaq;
}

type Delegate = {
  findMany: jest.Mock;
  findFirst: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  count: jest.Mock;
};

describe('CmsFaqService (generic base coverage)', () => {
  let delegate: Delegate;
  let prisma: { cmsFaq: Delegate; $transaction: jest.Mock };
  let audit: { record: jest.Mock };
  let cache: { invalidate: jest.Mock };
  let revalidation: { trigger: jest.Mock };
  let service: CmsFaqService;

  beforeEach(() => {
    delegate = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    };
    prisma = {
      cmsFaq: delegate,
      $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    revalidation = { trigger: jest.fn() };
    service = new CmsFaqService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      cache as unknown as CmsCacheService,
      revalidation as unknown as CmsRevalidationService,
    );
  });

  it('lists non-deleted rows ordered by sortOrder', async () => {
    delegate.findMany.mockResolvedValue([makeFaq()]);
    const out = await service.list();
    expect(out).toHaveLength(1);
    expect(delegate.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('gets a row by id', async () => {
    delegate.findFirst.mockResolvedValue(makeFaq());
    const out = await service.get('faq-1');
    expect(out.id).toBe('faq-1');
  });

  it('throws NotFound when the row is missing', async () => {
    delegate.findFirst.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates, audits, invalidates cache and revalidates', async () => {
    delegate.create.mockResolvedValue(makeFaq());
    const out = await service.create(actor, { question: 'Q?', answer: 'A' }, ctx);
    expect(out.id).toBe('faq-1');
    const createArg = delegate.create.mock.calls[0][0].data;
    expect(createArg.createdByAdminId).toBe('admin-1');
    expect(createArg.updatedByAdminId).toBe('admin-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cms.edit', targetType: 'CmsFaq' }),
    );
    expect(cache.invalidate).toHaveBeenCalledWith('faqs');
    expect(revalidation.trigger).toHaveBeenCalledWith(['cms:faqs']);
  });

  it('maps a P2002 unique violation to a 409', async () => {
    delegate.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    await expect(service.create(actor, { question: 'Q', answer: 'A' }, ctx)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rethrows a non-P2002 error unchanged', async () => {
    delegate.create.mockRejectedValue(new Error('boom'));
    await expect(service.create(actor, { question: 'Q', answer: 'A' }, ctx)).rejects.toThrow(
      'boom',
    );
  });

  it('updates only the provided fields', async () => {
    delegate.findFirst.mockResolvedValue(makeFaq());
    delegate.update.mockResolvedValue(makeFaq({ answer: 'B' }));
    await service.update(actor, 'faq-1', { answer: 'B' }, ctx);
    const data = delegate.update.mock.calls[0][0].data;
    expect(data).toEqual({ answer: 'B', updatedByAdminId: 'admin-1' });
  });

  it('soft-deletes and audits', async () => {
    delegate.findFirst.mockResolvedValue(makeFaq());
    delegate.update.mockResolvedValue(makeFaq({ deletedAt: new Date() }));
    await service.remove(actor, 'faq-1', ctx);
    const data = delegate.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalled();
  });

  it('publishes: sets status + publishedAt and audits under cms.publish', async () => {
    delegate.findFirst.mockResolvedValue(makeFaq());
    delegate.update.mockResolvedValue(makeFaq({ status: 'Published', publishedAt: new Date() }));
    const out = await service.setPublished(actor, 'faq-1', true, ctx);
    expect(out.status).toBe('Published');
    const data = delegate.update.mock.calls[0][0].data;
    expect(data.status).toBe('Published');
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'cms.publish' }));
  });

  it('unpublishes: clears publishedAt', async () => {
    delegate.findFirst.mockResolvedValue(makeFaq({ status: 'Published' }));
    delegate.update.mockResolvedValue(makeFaq({ status: 'Draft', publishedAt: null }));
    await service.setPublished(actor, 'faq-1', false, ctx);
    const data = delegate.update.mock.calls[0][0].data;
    expect(data.status).toBe('Draft');
    expect(data.publishedAt).toBeNull();
  });

  it('reorders in a transaction and returns the fresh list', async () => {
    const ids = ['faq-1', 'faq-2'];
    delegate.findMany
      .mockResolvedValueOnce([makeFaq({ id: 'faq-1' }), makeFaq({ id: 'faq-2' })]) // validation
      .mockResolvedValueOnce([makeFaq({ id: 'faq-1' }), makeFaq({ id: 'faq-2' })]); // list()
    delegate.update.mockResolvedValue(makeFaq());
    const out = await service.reorder(actor, ids, ctx);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(out).toHaveLength(2);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'faq-1' },
      data: { sortOrder: 0, updatedByAdminId: 'admin-1' },
    });
  });

  it('rejects a reorder set with duplicate ids', async () => {
    await expect(service.reorder(actor, ['a', 'a'], ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a reorder set that does not match live rows', async () => {
    delegate.findMany.mockResolvedValue([makeFaq({ id: 'faq-1' })]);
    await expect(service.reorder(actor, ['faq-1', 'faq-2'], ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
