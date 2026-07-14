import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AuthUser } from '../auth/types/jwt-payload.interface';

const USER: AuthUser = { userId: 'user-1', email: 'user@example.com', isGuest: false };

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    list: jest.Mock;
    getUnreadCount: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
    registerPushToken: jest.Mock;
    deregisterPushToken: jest.Mock;
    getPreferences: jest.Mock;
    updatePreferences: jest.Mock;
  };

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getUnreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      registerPushToken: jest.fn(),
      deregisterPushToken: jest.fn(),
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
    };
    controller = new NotificationsController(service as unknown as NotificationsService);
  });

  it('list forwards the pagination query with the caller id', async () => {
    const page = { items: [], total: 0, limit: 20, offset: 0 };
    service.list.mockResolvedValue(page);

    await expect(controller.list(USER, { limit: 20 })).resolves.toBe(page);
    expect(service.list).toHaveBeenCalledWith('user-1', { limit: 20 });
  });

  it('getUnreadCount delegates to the service', async () => {
    service.getUnreadCount.mockResolvedValue({ unreadCount: 2 });

    await expect(controller.getUnreadCount(USER)).resolves.toEqual({ unreadCount: 2 });
    expect(service.getUnreadCount).toHaveBeenCalledWith('user-1');
  });

  it('markRead forwards the notification id', async () => {
    const dto = { id: 'n-1' };
    service.markRead.mockResolvedValue(dto);

    await expect(controller.markRead(USER, 'n-1')).resolves.toBe(dto);
    expect(service.markRead).toHaveBeenCalledWith('user-1', 'n-1');
  });

  it('markAllRead delegates to the service', async () => {
    service.markAllRead.mockResolvedValue({ updated: 3 });

    await expect(controller.markAllRead(USER)).resolves.toEqual({ updated: 3 });
    expect(service.markAllRead).toHaveBeenCalledWith('user-1');
  });

  it('registerPushToken forwards the DTO', async () => {
    const body = { token: 'tok', platform: 'ios' as const };
    service.registerPushToken.mockResolvedValue({ id: 'pt-1' });

    await controller.registerPushToken(USER, body);
    expect(service.registerPushToken).toHaveBeenCalledWith('user-1', body);
  });

  it('deregisterPushToken forwards the token path param', async () => {
    service.deregisterPushToken.mockResolvedValue({ success: true, removed: 1 });

    await controller.deregisterPushToken(USER, 'tok');
    expect(service.deregisterPushToken).toHaveBeenCalledWith('user-1', 'tok');
  });

  it('getPreferences delegates to the service', async () => {
    const prefs = { pushEnabled: true };
    service.getPreferences.mockResolvedValue(prefs);

    await expect(controller.getPreferences(USER)).resolves.toBe(prefs);
    expect(service.getPreferences).toHaveBeenCalledWith('user-1');
  });

  it('updatePreferences forwards the patch DTO', async () => {
    const body = { pushEnabled: false };
    service.updatePreferences.mockResolvedValue(body);

    await controller.updatePreferences(USER, body);
    expect(service.updatePreferences).toHaveBeenCalledWith('user-1', body);
  });
});
