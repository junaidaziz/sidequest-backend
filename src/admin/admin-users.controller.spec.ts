import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { UserAccountStatus } from './admin-users.constants';
import { AdminUserDetailDto, AdminUserPageDto } from './dto/admin-user-response.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

const ACTOR: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'admin@sq.com',
  roleId: 'role-1',
  sessionId: 'sess-1',
  mfaPending: false,
  mustChangePassword: false,
};

const IP = '10.0.0.9';
const UA = 'jest-agent';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let service: {
    list: jest.Mock;
    getDetail: jest.Mock;
    suspend: jest.Mock;
    reactivate: jest.Mock;
    restrict: jest.Mock;
    resetVerification: jest.Mock;
    exportUser: jest.Mock;
    deleteUser: jest.Mock;
  };

  const detail = { id: 'user-1', status: UserAccountStatus.Active } as AdminUserDetailDto;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getDetail: jest.fn(),
      suspend: jest.fn(),
      reactivate: jest.fn(),
      restrict: jest.fn(),
      resetVerification: jest.fn(),
      exportUser: jest.fn(),
      deleteUser: jest.fn(),
    };
    controller = new AdminUsersController(service as unknown as AdminUsersService);
  });

  it('list delegates the query through to the service', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 } as AdminUserPageDto;
    service.list.mockResolvedValue(page);
    const query = { search: 'ada' } as ListUsersQueryDto;

    await expect(controller.list(query)).resolves.toBe(page);
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('getDetail delegates the id', async () => {
    service.getDetail.mockResolvedValue(detail);
    await expect(controller.getDetail('user-1')).resolves.toBe(detail);
    expect(service.getDetail).toHaveBeenCalledWith('user-1');
  });

  it('suspend forwards dto + assembled audit context', async () => {
    service.suspend.mockResolvedValue(detail);
    await controller.suspend(ACTOR, 'user-1', { reason: 'abuse' }, IP, UA);
    expect(service.suspend).toHaveBeenCalledWith(
      'user-1',
      { reason: 'abuse' },
      {
        actorAdminUserId: 'admin-1',
        ipAddress: IP,
        userAgent: UA,
      },
    );
  });

  it('reactivate forwards the assembled context', async () => {
    service.reactivate.mockResolvedValue(detail);
    await controller.reactivate(ACTOR, 'user-1', IP, UA);
    expect(service.reactivate).toHaveBeenCalledWith('user-1', {
      actorAdminUserId: 'admin-1',
      ipAddress: IP,
      userAgent: UA,
    });
  });

  it('restrict forwards dto + context', async () => {
    service.restrict.mockResolvedValue(detail);
    const dto = { features: [], reason: 'r' };
    await controller.restrict(ACTOR, 'user-1', dto, IP, UA);
    expect(service.restrict).toHaveBeenCalledWith(
      'user-1',
      dto,
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
      }),
    );
  });

  it('resetVerification forwards dto + context', async () => {
    service.resetVerification.mockResolvedValue({
      completionId: 'c1',
      verificationStatus: 'Pending',
    });
    const dto = { completionId: 'c1' };
    await controller.resetVerification(ACTOR, 'user-1', dto, IP, UA);
    expect(service.resetVerification).toHaveBeenCalledWith('user-1', dto, expect.any(Object));
  });

  it('exportUser forwards id + context', async () => {
    service.exportUser.mockResolvedValue({ profile: detail });
    await controller.exportUser(ACTOR, 'user-1', IP, UA);
    expect(service.exportUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
      }),
    );
  });

  it('deleteUser passes the reason and returns a success acknowledgement', async () => {
    service.deleteUser.mockResolvedValue(undefined);
    const result = await controller.deleteUser(
      ACTOR,
      'user-1',
      { confirm: true, reason: 'gdpr' },
      IP,
      UA,
    );
    expect(service.deleteUser).toHaveBeenCalledWith('user-1', 'gdpr', expect.any(Object));
    expect(result).toEqual({ success: true });
  });

  it('defaults a missing user-agent header to null in the context', async () => {
    service.reactivate.mockResolvedValue(detail);
    await controller.reactivate(ACTOR, 'user-1', IP);
    expect(service.reactivate).toHaveBeenCalledWith('user-1', {
      actorAdminUserId: 'admin-1',
      ipAddress: IP,
      userAgent: null,
    });
  });
});
