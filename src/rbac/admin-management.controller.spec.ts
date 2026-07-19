import { AdminManagementController } from './admin-management.controller';
import { AdminManagementService } from './admin-management.service';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';

const ACTOR: AuthAdmin = {
  adminUserId: 'actor-1',
  email: 'o@b.com',
  roleId: 'r',
  sessionId: 's',
  mfaPending: false,
  mustChangePassword: false,
};

describe('AdminManagementController', () => {
  let service: Record<string, jest.Mock>;
  let controller: AdminManagementController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      invite: jest.fn().mockResolvedValue({ id: 'a' }),
      get: jest.fn().mockResolvedValue({ id: 'a' }),
      update: jest.fn().mockResolvedValue({ id: 'a' }),
      disable: jest.fn().mockResolvedValue({ id: 'a' }),
      resetMfa: jest.fn().mockResolvedValue(undefined),
      revokeSessions: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AdminManagementController(service as unknown as AdminManagementService);
  });

  it('list / get delegate', async () => {
    await controller.list();
    await controller.get('a');
    expect(service.list).toHaveBeenCalled();
    expect(service.get).toHaveBeenCalledWith('a');
  });

  it('invite passes actor + context', async () => {
    await controller.invite(ACTOR, { email: 'a@b.com', displayName: 'A', roleId: 'r' }, '1.2.3.4');
    expect(service.invite).toHaveBeenCalledWith(ACTOR, expect.any(Object), expect.any(Object));
  });

  it('update / disable delegate', async () => {
    await controller.update(ACTOR, 'a', { displayName: 'X' }, '1.2.3.4');
    await controller.disable(ACTOR, 'a', '1.2.3.4');
    expect(service.update).toHaveBeenCalled();
    expect(service.disable).toHaveBeenCalled();
  });

  it('reset-mfa / revoke-sessions return success', async () => {
    expect(await controller.resetMfa(ACTOR, 'a', '1.2.3.4')).toEqual({ success: true });
    expect(await controller.revokeSessions(ACTOR, 'a', '1.2.3.4')).toEqual({ success: true });
  });
});
