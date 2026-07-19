import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';

const ACTOR: AuthAdmin = {
  adminUserId: 'actor-1',
  email: 'o@b.com',
  roleId: 'r',
  sessionId: 's',
  mfaPending: false,
  mustChangePassword: false,
};

describe('RoleController', () => {
  let service: Record<string, jest.Mock>;
  let controller: RoleController;

  beforeEach(() => {
    service = {
      listRoles: jest.fn().mockResolvedValue([]),
      listPermissions: jest.fn().mockResolvedValue([]),
      updateRolePermissions: jest.fn().mockResolvedValue({ id: 'r' }),
    };
    controller = new RoleController(service as unknown as RoleService);
  });

  it('listRoles / listPermissions delegate', async () => {
    await controller.listRoles();
    await controller.listPermissions();
    expect(service.listRoles).toHaveBeenCalled();
    expect(service.listPermissions).toHaveBeenCalled();
  });

  it('updateRolePermissions passes actor + context', async () => {
    await controller.updateRolePermissions(ACTOR, 'r', { permissionKeys: ['users.view'] }, '1.2.3.4');
    expect(service.updateRolePermissions).toHaveBeenCalledWith(
      ACTOR,
      'r',
      { permissionKeys: ['users.view'] },
      expect.any(Object),
    );
  });
});
