import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppConfig } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CmsRevalidationService } from '../cms/services/cms-revalidation.service';
import { AppConfigService } from './app-config.service';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { CmsRequestContext } from '../cms/types/cms.types';

const actor: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'a@x.com',
  roleId: 'r',
  sessionId: 's',
  mfaPending: false,
  mustChangePassword: false,
};
const ctx: CmsRequestContext = { ipAddress: null, userAgent: null };

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const now = new Date();
  return {
    id: 'c-1',
    key: 'appStoreUrl',
    value: 'https://apple',
    description: null,
    createdByAdminId: null,
    updatedByAdminId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as AppConfig;
}

describe('AppConfigService', () => {
  let prisma: {
    appConfig: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; buildRecord: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let revalidation: { trigger: jest.Mock };
  let service: AppConfigService;

  beforeEach(() => {
    prisma = {
      appConfig: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
    };
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
      buildRecord: jest.fn(() => Promise.resolve({})),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    revalidation = { trigger: jest.fn() };
    service = new AppConfigService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      redis as unknown as RedisService,
      revalidation as unknown as CmsRevalidationService,
    );
  });

  it('lists entries and flags public keys', async () => {
    prisma.appConfig.findMany.mockResolvedValue([
      makeConfig({ key: 'appStoreUrl' }),
      makeConfig({ key: 'internalFlag', value: true }),
    ]);
    const out = await service.list();
    expect(out.find((c) => c.key === 'appStoreUrl')?.isPublic).toBe(true);
    expect(out.find((c) => c.key === 'internalFlag')?.isPublic).toBe(false);
  });

  it('gets a key (404 when missing)', async () => {
    prisma.appConfig.findFirst.mockResolvedValueOnce(makeConfig());
    expect((await service.get('appStoreUrl')).key).toBe('appStoreUrl');
    prisma.appConfig.findFirst.mockResolvedValueOnce(null);
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an invalid key format', async () => {
    await expect(service.upsert(actor, 'bad key!', { value: 1 }, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates a public key: audits, busts cache, revalidates', async () => {
    prisma.appConfig.findUnique.mockResolvedValue(null);
    prisma.appConfig.upsert.mockResolvedValue(makeConfig({ key: 'appStoreUrl' }));
    await service.upsert(actor, 'appStoreUrl', { value: 'https://apple' }, ctx);
    expect(audit.buildRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_config.manage' }),
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('config:public');
    expect(revalidation.trigger).toHaveBeenCalledWith(['config:public']);
  });

  it('updating an INTERNAL key does not revalidate the public surface', async () => {
    prisma.appConfig.findUnique.mockResolvedValue(makeConfig({ key: 'internalFlag' }));
    prisma.appConfig.upsert.mockResolvedValue(makeConfig({ key: 'internalFlag', value: false }));
    await service.upsert(actor, 'internalFlag', { value: false }, ctx);
    expect(revalidation.trigger).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('soft-deletes a key (404 when missing)', async () => {
    prisma.appConfig.findFirst.mockResolvedValueOnce(makeConfig());
    prisma.appConfig.update.mockResolvedValue(makeConfig({ deletedAt: new Date() }));
    await service.remove(actor, 'appStoreUrl', ctx);
    expect(prisma.appConfig.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);

    prisma.appConfig.findFirst.mockResolvedValueOnce(null);
    await expect(service.remove(actor, 'nope', ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns only allow-listed public keys as a map (cache miss)', async () => {
    prisma.appConfig.findMany.mockResolvedValue([
      makeConfig({ key: 'appStoreUrl', value: 'https://apple' }),
      makeConfig({ key: 'contactEmail', value: 'hi@x.com' }),
    ]);
    const map = await service.getPublic();
    expect(map).toEqual({ appStoreUrl: 'https://apple', contactEmail: 'hi@x.com' });
    expect(redis.set).toHaveBeenCalled();
  });

  it('serves public config from cache when warm', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ appStoreUrl: 'cached' }));
    const map = await service.getPublic();
    expect(map).toEqual({ appStoreUrl: 'cached' });
    expect(prisma.appConfig.findMany).not.toHaveBeenCalled();
  });
});
