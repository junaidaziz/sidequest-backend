import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminTokenService } from './admin-token.service';

function configWith(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    ADMIN_JWT_SECRET: 'test-admin-secret',
    ADMIN_JWT_ACCESS_TOKEN_TTL: '15m',
    ADMIN_JWT_REFRESH_TOKEN_TTL: '12h',
    ...overrides,
  };
  return {
    getOrThrow: (k: string) => values[k]!,
    get: (k: string) => values[k],
  } as unknown as ConfigService;
}

describe('AdminTokenService', () => {
  const jwt = new JwtService({});
  let service: AdminTokenService;

  beforeEach(() => {
    service = new AdminTokenService(jwt, configWith());
  });

  it('issues an access+refresh pair with a shared session id and a bcrypt hash', async () => {
    const set = await service.issue('admin-1', 'session-1');
    expect(set.sessionId).toBe('session-1');
    expect(set.accessToken).toBeDefined();
    expect(set.refreshToken).toBeDefined();
    expect(set.refreshTokenHash).toMatch(/^\$2[aby]\$/);
    expect(set.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('generates a session id when one is not provided', async () => {
    const set = await service.issue('admin-1');
    expect(set.sessionId).toMatch(/[0-9a-f-]{36}/);
  });

  it('verifies its own refresh token and rejects an access token', async () => {
    const set = await service.issue('admin-1', 'session-1');
    const payload = await service.verifyRefresh(set.refreshToken);
    expect(payload.sub).toBe('admin-1');
    expect(payload.sid).toBe('session-1');
    await expect(service.verifyRefresh(set.accessToken)).rejects.toThrow('Not a refresh token');
  });

  it('compareRefresh matches the issued token against its stored hash', async () => {
    const set = await service.issue('admin-1', 'session-1');
    expect(await service.compareRefresh(set.refreshToken, set.refreshTokenHash)).toBe(true);
    expect(await service.compareRefresh('wrong', set.refreshTokenHash)).toBe(false);
  });

  it('falls back to a 12h refresh expiry when the TTL has no time unit', async () => {
    // "3600" is a valid jwt expiresIn (ms) but not matched by the h/m/s/d parser,
    // so the session-row expiry math falls back to 12h.
    service = new AdminTokenService(jwt, configWith({ ADMIN_JWT_REFRESH_TOKEN_TTL: '3600' }));
    const set = await service.issue('admin-1', 'session-1');
    const twelveHours = 12 * 60 * 60 * 1000;
    expect(set.expiresAt.getTime()).toBeGreaterThan(Date.now() + twelveHours - 5000);
  });

  it('uses default TTLs when the env values are unset', async () => {
    service = new AdminTokenService(
      jwt,
      configWith({ ADMIN_JWT_ACCESS_TOKEN_TTL: undefined, ADMIN_JWT_REFRESH_TOKEN_TTL: undefined }),
    );
    const set = await service.issue('admin-1');
    expect(set.accessToken).toBeDefined();
  });
});
