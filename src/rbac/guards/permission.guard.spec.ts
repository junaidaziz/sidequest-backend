import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { PermissionResolverService } from '../permission-resolver.service';
import { PermissionGuard } from './permission.guard';

function contextWith(user: AuthAdmin | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function baseAdmin(overrides: Partial<AuthAdmin> = {}): AuthAdmin {
  return {
    adminUserId: 'admin-1',
    email: 'a@b.com',
    roleId: 'role-1',
    sessionId: 'session-1',
    mfaPending: false,
    mustChangePassword: false,
    ...overrides,
  };
}

describe('PermissionGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let resolver: { hasAll: jest.Mock };
  let guard: PermissionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    resolver = { hasAll: jest.fn() };
    guard = new PermissionGuard(
      reflector as unknown as Reflector,
      resolver as unknown as PermissionResolverService,
    );
  });

  it('allows a route with no @RequirePermission metadata', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(await guard.canActivate(contextWith(baseAdmin()))).toBe(true);
  });

  it('rejects when no admin is attached to the request', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.view']);
    await expect(guard.canActivate(contextWith(undefined))).rejects.toThrow(UnauthorizedException);
  });

  it('blocks an admin who must change their password', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.view']);
    await expect(
      guard.canActivate(contextWith(baseAdmin({ mustChangePassword: true }))),
    ).rejects.toThrow('Password change required');
  });

  it('blocks an admin with pending MFA enrollment', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.view']);
    await expect(guard.canActivate(contextWith(baseAdmin({ mfaPending: true })))).rejects.toThrow(
      'MFA enrollment required',
    );
  });

  it('allows when the admin holds all required permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.view']);
    resolver.hasAll.mockResolvedValue(true);
    expect(await guard.canActivate(contextWith(baseAdmin()))).toBe(true);
    expect(resolver.hasAll).toHaveBeenCalledWith('admin-1', ['users.view']);
  });

  it('denies with 403 when a required permission is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue(['users.delete']);
    resolver.hasAll.mockResolvedValue(false);
    await expect(guard.canActivate(contextWith(baseAdmin()))).rejects.toThrow(ForbiddenException);
  });
});
