import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
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

  describe('error message parity', () => {
    // Unconfigured, missing-header, and wrong-key denials must all be
    // indistinguishable from the response body — otherwise the message itself
    // leaks which case a caller hit.
    const denialCases: Array<[string, string | undefined, string | undefined]> = [
      ['unconfigured key', undefined, undefined],
      ['missing header', KEY, undefined],
      ['wrong key', KEY, 'not-the-key'],
    ];

    it.each(denialCases)('"%s" throws the same message', (_label, configuredKey, header) => {
      const guard = guardWith(configuredKey);
      expect(() => guard.canActivate(contextWithHeader(header))).toThrow('Invalid admin key');
    });
  });

  it('denies a near-miss (all but the last character correct)', () => {
    const guard = guardWith(KEY);
    expect(() => guard.canActivate(contextWithHeader(KEY.slice(0, -1) + 'x'))).toThrow(
      ForbiddenException,
    );
  });

  it('compares via crypto.timingSafeEqual over digests, not a raw !== on the secret', () => {
    // A behavioral test can't prove constant-timing; assert the source
    // structurally uses timingSafeEqual instead of a short-circuiting !==.
    const source = readFileSync(join(__dirname, 'admin.guard.ts'), 'utf8');
    expect(source).toMatch(/timingSafeEqual/);
    expect(source).not.toMatch(/provided\s*!==\s*expected/);
  });
});
