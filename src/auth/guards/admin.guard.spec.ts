import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminGuard, ADMIN_API_KEY_ENV, ADMIN_KEY_HEADER } from './admin.guard';

function contextWithHeader(value: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { [ADMIN_KEY_HEADER]: value } }),
    }),
  } as unknown as ExecutionContext;
}

function guardWith(configuredKey: string | undefined): AdminGuard {
  const config = {
    get: jest.fn((key: string) => (key === ADMIN_API_KEY_ENV ? configuredKey : undefined)),
  } as unknown as ConfigService;
  return new AdminGuard(config);
}

describe('AdminGuard', () => {
  const KEY = 'super-secret-admin-key';

  it('allows the request when the header matches the configured key', () => {
    const guard = guardWith(KEY);
    expect(guard.canActivate(contextWithHeader(KEY))).toBe(true);
  });

  it('denies when the header is missing', () => {
    const guard = guardWith(KEY);
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(ForbiddenException);
  });

  it('denies when the header value is wrong', () => {
    const guard = guardWith(KEY);
    expect(() => guard.canActivate(contextWithHeader('not-the-key'))).toThrow(ForbiddenException);
  });

  it('denies when the header is an array (duplicate header attack) rather than a string', () => {
    const guard = guardWith(KEY);
    expect(() => guard.canActivate(contextWithHeader([KEY]))).toThrow(ForbiddenException);
  });

  describe('fail-closed configuration', () => {
    it('denies every request when ADMIN_API_KEY is unset', () => {
      const guard = guardWith(undefined);
      expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(ForbiddenException);
    });

    it('denies even a "matching" empty header when ADMIN_API_KEY is empty', () => {
      const guard = guardWith('');
      // Both configured key and provided header are '' — must still deny, proving
      // the guard never falls open to "no auth required".
      expect(() => guard.canActivate(contextWithHeader(''))).toThrow(ForbiddenException);
    });
  });
});
