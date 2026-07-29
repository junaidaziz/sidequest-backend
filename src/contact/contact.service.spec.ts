import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { ContactSubmission } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContactActionContext, ContactService } from './contact.service';

const CTX: ContactActionContext = {
  actorAdminUserId: 'admin-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

const SUBMISSION_INPUT = {
  name: 'Ada',
  email: 'ada@example.com',
  topic: 'Partnership',
  message: 'Hello',
};

function buildSubmission(overrides: Partial<ContactSubmission> = {}): ContactSubmission {
  return {
    id: 'sub-1',
    name: 'Ada',
    email: 'ada@example.com',
    topic: 'Partnership',
    message: 'Hello',
    status: 'New',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(configValue: string | undefined): {
  service: ContactService;
  prisma: {
    contactSubmission: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  email: { sendContactFormNotification: jest.Mock };
  audit: { record: jest.Mock };
} {
  const prisma = {
    contactSubmission: {
      create: jest.fn().mockResolvedValue(buildSubmission()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const email = { sendContactFormNotification: jest.fn().mockResolvedValue({ status: 'ok' }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(configValue) };
  const service = new ContactService(
    prisma as unknown as PrismaService,
    email as unknown as EmailService,
    audit as unknown as AuditLogService,
    config as unknown as ConfigService,
  );
  return { service, prisma, email, audit };
}

describe('ContactService', () => {
  describe('submit', () => {
    it('persists the submission and sends a notification email when configured', async () => {
      const { service, prisma, email } = buildService('ops@example.com');

      const result = await service.submit(SUBMISSION_INPUT);

      expect(prisma.contactSubmission.create).toHaveBeenCalledWith({
        data: SUBMISSION_INPUT,
      });
      expect(email.sendContactFormNotification).toHaveBeenCalledWith(
        'ops@example.com',
        expect.objectContaining({ name: 'Ada', topic: 'Partnership' }),
      );
      expect(result).toEqual({ success: true, id: 'sub-1' });
    });

    it('skips the email (but still persists) when CONTACT_NOTIFICATION_EMAIL is unset', async () => {
      const { service, prisma, email } = buildService(undefined);

      const result = await service.submit(SUBMISSION_INPUT);

      expect(prisma.contactSubmission.create).toHaveBeenCalled();
      expect(email.sendContactFormNotification).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('never fails the submission when the email send throws (best-effort)', async () => {
      const { service, email } = buildService('ops@example.com');
      email.sendContactFormNotification.mockRejectedValue(new Error('provider exploded'));

      await expect(service.submit(SUBMISSION_INPUT)).resolves.toEqual({
        success: true,
        id: 'sub-1',
      });
    });

    it('swallows a non-Error thrown by the email send (best-effort, no stack)', async () => {
      const { service, email } = buildService('ops@example.com');
      // A non-Error rejection exercises the `error instanceof Error ? … : undefined` false branch.
      email.sendContactFormNotification.mockRejectedValue('string failure');

      await expect(service.submit(SUBMISSION_INPUT)).resolves.toEqual({
        success: true,
        id: 'sub-1',
      });
    });
  });

  describe('list', () => {
    it('applies a status filter and pagination', async () => {
      const { service, prisma } = buildService('ops@example.com');
      prisma.contactSubmission.findMany.mockResolvedValue([buildSubmission()]);
      prisma.contactSubmission.count.mockResolvedValue(1);

      const result = await service.list({ status: 'New', page: 2, pageSize: 10 });

      expect(prisma.contactSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'New' }, skip: 10, take: 10 }),
      );
      expect(result).toEqual(
        expect.objectContaining({ total: 1, page: 2, pageSize: 10, items: expect.any(Array) }),
      );
    });

    it('applies default pagination (page 1, pageSize 25) and no status filter when omitted', async () => {
      const { service, prisma } = buildService('ops@example.com');

      const result = await service.list({});

      expect(prisma.contactSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 25 }),
      );
      expect(result).toEqual(expect.objectContaining({ page: 1, pageSize: 25 }));
    });
  });

  describe('getById', () => {
    it('returns the submission when found', async () => {
      const { service, prisma } = buildService('ops@example.com');
      prisma.contactSubmission.findUnique.mockResolvedValue(buildSubmission());

      const result = await service.getById('sub-1');

      expect(result.id).toBe('sub-1');
    });

    it('throws 404 when not found', async () => {
      const { service, prisma } = buildService('ops@example.com');
      prisma.contactSubmission.findUnique.mockResolvedValue(null);

      await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates status and writes an audit record', async () => {
      const { service, prisma, audit } = buildService('ops@example.com');
      prisma.contactSubmission.findUnique.mockResolvedValue(buildSubmission({ status: 'New' }));
      prisma.contactSubmission.update.mockResolvedValue(buildSubmission({ status: 'Resolved' }));

      const result = await service.updateStatus('sub-1', { status: 'Resolved' }, CTX);

      expect(prisma.contactSubmission.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'Resolved' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'contact.status.update',
          targetType: 'ContactSubmission',
        }),
      );
      expect(result.status).toBe('Resolved');
    });

    it('throws 404 when the submission does not exist', async () => {
      const { service, prisma } = buildService('ops@example.com');
      prisma.contactSubmission.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus('missing', { status: 'Read' }, CTX)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
