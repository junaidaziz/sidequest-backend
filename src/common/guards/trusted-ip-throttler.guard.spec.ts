import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { TrustedIpThrottlerGuard } from './trusted-ip-throttler.guard';

const SECRET = 'super-secret-shared-with-web';
const FORWARDED_IPV4 = '203.0.113.10';
const FORWARDED_IPV6 = '2001:db8::1';
const REAL_IP = '198.51.100.7';

/**
 * The guard only ever reads `ip` and `headers` off the request, so a minimal
 * shape is enough. `getTracker` is `protected`; tests reach it via bracket access.
 */
type TestRequest = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

function makeGuard(internalProxySecret?: string): TrustedIpThrottlerGuard {
  // getTracker never touches options/storage, so empty stand-ins are sufficient.
  const options = { throttlers: [] } as unknown as ThrottlerModuleOptions;
  const storage = {} as ThrottlerStorage;
  const reflector = new Reflector();
  const config = {
    get: (key: string): string | undefined =>
      key === 'INTERNAL_PROXY_SECRET' ? internalProxySecret : undefined,
  } as unknown as ConfigService;
  return new TrustedIpThrottlerGuard(options, storage, reflector, config);
}

function track(guard: TrustedIpThrottlerGuard, req: TestRequest): Promise<string> {
  return (guard as unknown as { getTracker(req: TestRequest): Promise<string> }).getTracker(req);
}

describe('TrustedIpThrottlerGuard', () => {
  describe('with INTERNAL_PROXY_SECRET configured', () => {
    let guard: TrustedIpThrottlerGuard;

    beforeEach(() => {
      guard = makeGuard(SECRET);
    });

    it('uses the forwarded IPv4 when the secret is correct and the IP is valid', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': SECRET,
          'x-forwarded-client-ip': FORWARDED_IPV4,
        },
      });
      expect(tracker).toBe(FORWARDED_IPV4);
    });

    it('uses the forwarded IPv6 when the secret is correct and the IP is valid', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': SECRET,
          'x-forwarded-client-ip': FORWARDED_IPV6,
        },
      });
      expect(tracker).toBe(FORWARDED_IPV6);
    });

    it('falls back to req.ip when the secret is wrong (spoof attempt)', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': 'not-the-secret',
          'x-forwarded-client-ip': FORWARDED_IPV4,
        },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('falls back to req.ip when the secret is a different length (constant-time guard)', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': 'short',
          'x-forwarded-client-ip': FORWARDED_IPV4,
        },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('falls back to req.ip when the secret header is missing', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: { 'x-forwarded-client-ip': FORWARDED_IPV4 },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('falls back to req.ip when the secret header is repeated (array value)', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': [SECRET, SECRET],
          'x-forwarded-client-ip': FORWARDED_IPV4,
        },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('falls back to req.ip when the forwarded IP is malformed', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': SECRET,
          'x-forwarded-client-ip': 'not-an-ip-address',
        },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('falls back to req.ip when the forwarded IP header is missing', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: { 'x-internal-proxy-secret': SECRET },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('falls back to req.ip when the forwarded IP is repeated (array value)', async () => {
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': SECRET,
          'x-forwarded-client-ip': [FORWARDED_IPV4, FORWARDED_IPV6],
        },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('falls back to req.ip when there are no headers at all', async () => {
      const tracker = await track(guard, { ip: REAL_IP });
      expect(tracker).toBe(REAL_IP);
    });

    it('returns an empty string when neither a trusted IP nor req.ip is present', async () => {
      const tracker = await track(guard, { headers: {} });
      expect(tracker).toBe('');
    });
  });

  describe('with INTERNAL_PROXY_SECRET unset', () => {
    it('ignores a correct-looking forward and always falls back to req.ip', async () => {
      const guard = makeGuard(undefined);
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': SECRET,
          'x-forwarded-client-ip': FORWARDED_IPV4,
        },
      });
      expect(tracker).toBe(REAL_IP);
    });

    it('treats an empty-string secret the same as unset', async () => {
      const guard = makeGuard('');
      const tracker = await track(guard, {
        ip: REAL_IP,
        headers: {
          'x-internal-proxy-secret': '',
          'x-forwarded-client-ip': FORWARDED_IPV4,
        },
      });
      expect(tracker).toBe(REAL_IP);
    });
  });
});
