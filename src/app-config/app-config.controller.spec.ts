import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AppConfigPublicController } from './app-config-public.controller';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';

const actor = { adminUserId: 'admin-1' } as AuthAdmin;

describe('AppConfigController', () => {
  let service: {
    list: jest.Mock;
    get: jest.Mock;
    upsert: jest.Mock;
    remove: jest.Mock;
    getPublic: jest.Mock;
  };

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ key: 'k' }),
      upsert: jest.fn().mockResolvedValue({ key: 'k' }),
      remove: jest.fn().mockResolvedValue(undefined),
      getPublic: jest.fn().mockResolvedValue({ appStoreUrl: 'x' }),
    };
  });

  it('admin routes delegate with an audit context', async () => {
    const c = new AppConfigController(service as unknown as AppConfigService);
    await c.list();
    await c.get('appStoreUrl');
    await c.upsert(actor, 'appStoreUrl', { value: 'x' }, '1.1.1.1', 'ua');
    await c.remove(actor, 'appStoreUrl', '1.1.1.1');
    expect(service.upsert).toHaveBeenCalledWith(
      actor,
      'appStoreUrl',
      { value: 'x' },
      { ipAddress: '1.1.1.1', userAgent: 'ua' },
    );
    expect(service.remove).toHaveBeenCalledWith(actor, 'appStoreUrl', expect.any(Object));
  });

  it('public controller wraps the map in { config }', async () => {
    const c = new AppConfigPublicController(service as unknown as AppConfigService);
    expect(await c.getPublic()).toEqual({ config: { appStoreUrl: 'x' } });
  });
});
