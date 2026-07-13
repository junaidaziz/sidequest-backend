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
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    getProfile: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createGuest: jest.fn().mockResolvedValue(TOKENS),
      signup: jest.fn().mockResolvedValue(TOKENS),
      login: jest.fn().mockResolvedValue(TOKENS),
      refresh: jest.fn().mockResolvedValue(TOKENS),
      logout: jest.fn().mockResolvedValue({ success: true }),
      getProfile: jest.fn(),
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

    const result = await controller.logout(user);

    expect(service.logout).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ success: true });
  });

  it('GET /auth/me returns the profile for the authenticated user', async () => {
    const profile: UserProfileDto = {
      id: 'user-1',
      email: 'ada@example.com',
      displayName: 'Ada',
      isGuest: false,
    };
    service.getProfile.mockResolvedValue(profile);
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };

    const result = await controller.me(user);

    expect(service.getProfile).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(profile);
  });
});
