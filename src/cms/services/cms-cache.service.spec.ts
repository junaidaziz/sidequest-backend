import { RedisService } from '../../redis/redis.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import { CmsCacheService } from './cms-cache.service';

type RedisMock = {
  get: jest.Mock;
  set: jest.Mock;
  scan: jest.Mock;
  del: jest.Mock;
};

function makeRedis(): RedisMock {
  return {
    get: jest.fn(),
    set: jest.fn(),
    scan: jest.fn(),
    del: jest.fn(),
  };
}

describe('CmsCacheService', () => {
  let redis: RedisMock;
  let service: CmsCacheService;

  beforeEach(() => {
    delete process.env.CMS_PUBLIC_CACHE_TTL_SECONDS;
    redis = makeRedis();
    service = new CmsCacheService(redis as unknown as RedisService);
  });

  it('throws at construction on an invalid TTL', () => {
    process.env.CMS_PUBLIC_CACHE_TTL_SECONDS = 'not-a-number';
    expect(() => new CmsCacheService(redis as unknown as RedisService)).toThrow(
      /CMS_PUBLIC_CACHE_TTL_SECONDS/,
    );
    delete process.env.CMS_PUBLIC_CACHE_TTL_SECONDS;
  });

  it('returns parsed value on a cache hit', async () => {
    redis.get.mockResolvedValue(JSON.stringify([{ id: '1' }]));
    const out = await service.get<Array<{ id: string }>>(CMS_CACHE_TAGS.faqs);
    expect(out).toEqual([{ id: '1' }]);
    expect(redis.get).toHaveBeenCalledWith('cms:public:faqs');
  });

  it('returns null on a miss', async () => {
    redis.get.mockResolvedValue(null);
    expect(await service.get(CMS_CACHE_TAGS.faqs)).toBeNull();
  });

  it('falls through (null) on a Redis read error', async () => {
    redis.get.mockRejectedValue(new Error('down'));
    expect(await service.get(CMS_CACHE_TAGS.faqs)).toBeNull();
  });

  it('writes with the configured TTL', async () => {
    redis.set.mockResolvedValue('OK');
    await service.set(CMS_CACHE_TAGS.sections, [{ id: 'x' }]);
    expect(redis.set).toHaveBeenCalledWith(
      'cms:public:sections',
      JSON.stringify([{ id: 'x' }]),
      'EX',
      300,
    );
  });

  it('swallows a Redis write error', async () => {
    redis.set.mockRejectedValue(new Error('down'));
    await expect(service.set(CMS_CACHE_TAGS.sections, [])).resolves.toBeUndefined();
  });

  it('invalidates via SCAN + DEL across cursor pages', async () => {
    redis.scan
      .mockResolvedValueOnce(['10', ['cms:public:faqs', 'cms:public:faqs:extra']])
      .mockResolvedValueOnce(['0', []]);
    redis.del.mockResolvedValue(2);
    await service.invalidate(CMS_CACHE_TAGS.faqs);
    expect(redis.scan).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledWith('cms:public:faqs', 'cms:public:faqs:extra');
  });

  it('swallows a Redis invalidation error', async () => {
    redis.scan.mockRejectedValue(new Error('down'));
    await expect(service.invalidate(CMS_CACHE_TAGS.links)).resolves.toBeUndefined();
  });
});
