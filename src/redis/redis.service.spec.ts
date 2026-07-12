import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(() => {
    service = new RedisService();
  });

  it('connects on module init', async () => {
    const connect = jest.spyOn(service, 'connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', () => {
    const disconnect = jest.spyOn(service, 'disconnect').mockImplementation(() => undefined);

    service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
