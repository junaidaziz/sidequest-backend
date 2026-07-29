import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { AuthUser } from './types/jwt-payload.interface';

const TOKENS: AuthTokensDto = { accessToken: 'access', refreshToken: 'refresh' };

describe('AuthController', () => {
  let controller: AuthController;
  let service: {
    createGuest: jest.Mock;
    signup: jest.Mock;
    googleAuth: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    changePassword: jest.Mock;
    deleteAccount: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createGuest: jest.fn().mockResolvedValue(TOKENS),
      signup: jest.fn().mockResolvedValue(TOKENS),
      googleAuth: jest.fn().mockResolvedValue(TOKENS),
      login: jest.fn().mockResolvedValue(TOKENS),
      refresh: jest.fn().mockResolvedValue(TOKENS),
      logout: jest.fn().mockResolvedValue({ success: true }),
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn().mockResolvedValue({ success: true }),
      deleteAccount: jest.fn().mockResolvedValue({ success: true }),
      forgotPassword: jest.fn().mockResolvedValue(undefined),
      resetPassword: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: service }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('POST /auth/guest delegates to createGuest', async () => {
    await expect(controller.createGuest()).resolves.toEqual(TOKENS);
    expect(service.createGuest).toHaveBeenCalledTimes(1);
  });

  it('POST /auth/signup forwards the DTO and Authorization header', async () => {
    const dto = { email: 'ada@example.com', password: 'password123' };

    const result = await controller.signup(dto, 'Bearer guest-token');

    expect(service.signup).toHaveBeenCalledWith(dto, 'Bearer guest-token');
    expect(result).toEqual(TOKENS);
  });

  it('POST /auth/signup works without an Authorization header', async () => {
    const dto = { email: 'ada@example.com', password: 'password123' };

    await controller.signup(dto);

    expect(service.signup).toHaveBeenCalledWith(dto, undefined);
  });

  it('POST /auth/google forwards the DTO and Authorization header', async () => {
    const dto = { idToken: 'google.id.token' };

    const result = await controller.google(dto, 'Bearer guest-token');

    expect(service.googleAuth).toHaveBeenCalledWith(dto, 'Bearer guest-token');
    expect(result).toEqual(TOKENS);
  });

  it('POST /auth/google works without an Authorization header', async () => {
    const dto = { idToken: 'google.id.token' };

    await controller.google(dto);

    expect(service.googleAuth).toHaveBeenCalledWith(dto, undefined);
  });

  it('POST /auth/google is rate-limited in the same sensitive tier as login/signup', () => {
    // The @Throttle metadata lands on the route handler function; comparing the
    // google handler's tier to login's proves it shares SENSITIVE_THROTTLE
    // (5 req / 60s) without hard-coding the numbers in two places.
    const limitKey = 'THROTTLER:LIMITdefault';
    const ttlKey = 'THROTTLER:TTLdefault';
    const googleLimit = Reflect.getMetadata(limitKey, AuthController.prototype.google) as unknown;
    const googleTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.google) as unknown;

    expect(googleLimit).toBe(
      Reflect.getMetadata(limitKey, AuthController.prototype.login) as unknown,
    );
    expect(googleTtl).toBe(Reflect.getMetadata(ttlKey, AuthController.prototype.login) as unknown);
    expect(googleLimit).toBe(5);
    expect(googleTtl).toBe(60_000);
  });

  it('POST /auth/forgot-password always returns { success: true } and delegates', async () => {
    const result = await controller.forgotPassword({ email: 'ada@example.com' });

    expect(service.forgotPassword).toHaveBeenCalledWith({ email: 'ada@example.com' });
    // Always a generic success — even the service resolving undefined must not
    // change the always-200 no-enumeration contract.
    expect(result).toEqual({ success: true });
  });

  it('POST /auth/reset-password forwards the token + new password DTO', async () => {
    const dto = { token: 'user-1.raw', newPassword: 'n3w-password' };

    const result = await controller.resetPassword(dto);

    expect(service.resetPassword).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ success: true });
  });

  it('POST /auth/forgot-password + /auth/reset-password are in the sensitive throttle tier', () => {
    const limitKey = 'THROTTLER:LIMITdefault';
    const ttlKey = 'THROTTLER:TTLdefault';
    for (const handler of [
      AuthController.prototype.forgotPassword,
      AuthController.prototype.resetPassword,
    ]) {
      expect(Reflect.getMetadata(limitKey, handler)).toBe(5);
      expect(Reflect.getMetadata(ttlKey, handler)).toBe(60_000);
    }
  });

  it('POST /auth/login forwards the credentials DTO', async () => {
    const dto = { email: 'ada@example.com', password: 'password123' };

    const result = await controller.login(dto);

    expect(service.login).toHaveBeenCalledWith(dto);
    expect(result).toEqual(TOKENS);
  });

  it('POST /auth/refresh forwards the refresh DTO', async () => {
    const dto = { refreshToken: 'refresh.jwt' };

    const result = await controller.refresh(dto);

    expect(service.refresh).toHaveBeenCalledWith(dto);
    expect(result).toEqual(TOKENS);
  });

  it('POST /auth/logout revokes the refresh token for the authenticated user', async () => {
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };

    const result = await controller.logout(user, {});

    expect(service.logout).toHaveBeenCalledWith('user-1', undefined);
    expect(result).toEqual({ success: true });
  });

  it('POST /auth/logout forwards a supplied push token for deregistration (M21.3)', async () => {
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };

    await controller.logout(user, { pushToken: 'ExponentPushToken[abc]' });

    expect(service.logout).toHaveBeenCalledWith('user-1', 'ExponentPushToken[abc]');
  });

  it('GET /auth/me returns the profile for the authenticated user', async () => {
    const profile: UserProfileDto = {
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
      isGuest: false,
      timezone: 'UTC',
      avatarUrl: null,
      avatarVariants: [],
    };
    service.getProfile.mockResolvedValue(profile);
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };

    const result = await controller.me(user);

    expect(service.getProfile).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(profile);
  });

  it('PATCH /auth/me forwards the update DTO and returns the updated profile', async () => {
    const profile: UserProfileDto = {
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'New Name',
      isGuest: false,
      timezone: 'America/New_York',
      avatarUrl: null,
      avatarVariants: [],
    };
    service.updateProfile.mockResolvedValue(profile);
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };
    const dto = { displayName: 'New Name', timezone: 'America/New_York' };

    const result = await controller.updateMe(user, dto);

    expect(service.updateProfile).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual(profile);
  });

  it('PATCH /auth/password forwards the DTO for the authenticated user', async () => {
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };
    const dto = { currentPassword: 'old-password', newPassword: 'new-password' };

    const result = await controller.changePassword(user, dto);

    expect(service.changePassword).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ success: true });
  });

  it('PATCH /auth/password is rate-limited in the same sensitive tier as login', () => {
    const limitKey = 'THROTTLER:LIMITdefault';
    const ttlKey = 'THROTTLER:TTLdefault';
    const pwLimit = Reflect.getMetadata(
      limitKey,
      AuthController.prototype.changePassword,
    ) as unknown;
    const pwTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.changePassword) as unknown;

    expect(pwLimit).toBe(Reflect.getMetadata(limitKey, AuthController.prototype.login) as unknown);
    expect(pwTtl).toBe(Reflect.getMetadata(ttlKey, AuthController.prototype.login) as unknown);
    expect(pwLimit).toBe(5);
    expect(pwTtl).toBe(60_000);
  });

  it('DELETE /auth/me forwards the re-auth DTO for the authenticated user', async () => {
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };
    const dto = { currentPassword: 'old-password' };

    const result = await controller.deleteAccount(user, dto);

    expect(service.deleteAccount).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ success: true });
  });

  it('DELETE /auth/me is rate-limited in the same sensitive tier as login', () => {
    const limitKey = 'THROTTLER:LIMITdefault';
    const ttlKey = 'THROTTLER:TTLdefault';
    const delLimit = Reflect.getMetadata(
      limitKey,
      AuthController.prototype.deleteAccount,
    ) as unknown;
    const delTtl = Reflect.getMetadata(ttlKey, AuthController.prototype.deleteAccount) as unknown;

    expect(delLimit).toBe(Reflect.getMetadata(limitKey, AuthController.prototype.login) as unknown);
    expect(delTtl).toBe(Reflect.getMetadata(ttlKey, AuthController.prototype.login) as unknown);
    expect(delLimit).toBe(5);
    expect(delTtl).toBe(60_000);
  });
});
