import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AuthAdmin } from './types/admin-jwt-payload.interface';

const ADMIN: AuthAdmin = {
  adminUserId: 'admin-1',
  email: 'a@b.com',
  roleId: 'r',
  sessionId: 's',
  mfaPending: false,
  mustChangePassword: false,
};

describe('AdminAuthController', () => {
  let service: Record<string, jest.Mock>;
  let controller: AdminAuthController;

  beforeEach(() => {
    service = {
      login: jest.fn().mockResolvedValue({ status: 'authenticated' }),
      completeMfaChallenge: jest.fn().mockResolvedValue({ accessToken: 'a' }),
      setupMfa: jest.fn().mockResolvedValue({ secret: 's' }),
      verifyMfa: jest.fn().mockResolvedValue({ recoveryCodes: [] }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'a' }),
      logout: jest.fn().mockResolvedValue(undefined),
      logoutAll: jest.fn().mockResolvedValue(undefined),
      listSessions: jest.fn().mockResolvedValue([]),
      forgotPassword: jest.fn().mockResolvedValue(undefined),
      resetPassword: jest.fn().mockResolvedValue(undefined),
      acceptInvitation: jest.fn().mockResolvedValue({ accessToken: 'a' }),
    };
    controller = new AdminAuthController(service as unknown as AdminAuthService);
  });

  it('login passes the IP + user-agent context', async () => {
    await controller.login({ email: 'a@b.com', password: 'x' }, '1.2.3.4', 'jest');
    expect(service.login).toHaveBeenCalledWith(
      { email: 'a@b.com', password: 'x' },
      { ipAddress: '1.2.3.4', userAgent: 'jest' },
    );
  });

  it('challenge delegates', async () => {
    await controller.challenge({ challengeId: 'c', code: '123456' }, '1.2.3.4');
    expect(service.completeMfaChallenge).toHaveBeenCalled();
  });

  it('setupMfa and verifyMfa delegate with the current admin', async () => {
    await controller.setupMfa(ADMIN, '1.2.3.4');
    await controller.verifyMfa(ADMIN, { code: '123456' }, '1.2.3.4');
    expect(service.setupMfa).toHaveBeenCalledWith(ADMIN, expect.any(Object));
    expect(service.verifyMfa).toHaveBeenCalledWith(ADMIN, '123456', expect.any(Object));
  });

  it('logout / logout-all return { success: true }', async () => {
    expect(await controller.logout(ADMIN, '1.2.3.4')).toEqual({ success: true });
    expect(await controller.logoutAll(ADMIN, '1.2.3.4')).toEqual({ success: true });
  });

  it('sessions delegates', async () => {
    await controller.sessions(ADMIN);
    expect(service.listSessions).toHaveBeenCalledWith(ADMIN);
  });

  it('forgot / reset always return success', async () => {
    expect(await controller.forgotPassword({ email: 'a@b.com' }, '1.2.3.4')).toEqual({
      success: true,
    });
    expect(
      await controller.resetPassword({ token: 't', newPassword: 'Abcdefgh12!@' }, '1.2.3.4'),
    ).toEqual({ success: true });
  });

  it('accept-invitation delegates with the token pulled from the body', async () => {
    const dto = { token: 'tok', password: 'Abcdefgh12!@' };
    await controller.acceptInvitation(dto, '1.2.3.4');
    expect(service.acceptInvitation).toHaveBeenCalledWith('tok', dto, expect.any(Object));
  });

  it('refresh delegates', async () => {
    await controller.refresh({ refreshToken: 'rt' }, '1.2.3.4');
    expect(service.refresh).toHaveBeenCalled();
  });
});
