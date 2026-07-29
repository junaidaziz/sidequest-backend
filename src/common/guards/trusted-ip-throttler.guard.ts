import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

/**
 * The subset of the incoming request this guard reads. Express lower-cases every
 * header key, so the header lookups below use lower-case names directly. A single
 * header can arrive as `string[]` (repeated header), which we treat as invalid —
 * only a single string value is ever trusted.
 */
interface TrackedRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/** Header the trusted `web` BFF sets to prove it is allowed to forward a client IP. */
const PROXY_SECRET_HEADER = 'x-internal-proxy-secret';
/** Header carrying the real browser IP that `web` is relaying on the user's behalf. */
const FORWARDED_CLIENT_IP_HEADER = 'x-forwarded-client-ip';

/**
 * Rate-limit tracker that adds one narrow, secret-gated trust path on top of the
 * stock {@link ThrottlerGuard}: it lets a single trusted caller (the `web` app's
 * server-to-server BFF) name the real browser IP behind a relayed request, so the
 * per-IP throttle counts that browser rather than `web`'s own server IP.
 *
 * Why this is needed: Railway's edge proxy fronts every request. `main.ts` sets
 * `trust proxy = 1`, which makes `req.ip` resolve correctly for traffic that
 * arrives *directly* at the edge (mobile app, direct API calls). But a request
 * that `web` relays server-side arrives at the edge as coming from `web`'s own
 * server, so `req.ip` is correctly `web`'s IP — not the browser's. Without the
 * mechanism below, every browser user funnelling through `web`'s public forms
 * (`/reset-password`, `/contact`, ...) would share one throttle budget.
 *
 * Trust is gated on a shared secret so it cannot be abused: only a caller that
 * knows `INTERNAL_PROXY_SECRET` can influence the tracker key. Any direct attacker
 * spoofing `x-forwarded-client-ip` without the secret is ignored and still
 * throttled by their real `req.ip`. If `INTERNAL_PROXY_SECRET` is unset, this trust
 * path is simply never available and the guard behaves exactly like the stock one.
 */
@Injectable()
export class TrustedIpThrottlerGuard extends ThrottlerGuard {
  /**
   * SHA-256 digest of the configured shared secret (always exactly 32 bytes),
   * not the raw secret bytes — comparing digests rather than raw values means
   * both sides of every `timingSafeEqual` call are guaranteed equal length by
   * construction, so there is no length branch and therefore no length-timing
   * oracle (an earlier length-guard-then-compare version let an attacker learn
   * the secret's byte length by timing the two code paths). `undefined` when
   * `INTERNAL_PROXY_SECRET` is unset (or empty) — in which case the
   * trusted-forward path is disabled and the guard behaves exactly like the
   * stock {@link ThrottlerGuard}.
   */
  private readonly internalProxySecretDigest: Buffer | undefined;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService,
  ) {
    super(options, storageService, reflector);
    // Treat an empty string the same as unset — degrade safely to `req.ip`.
    const secret = config.get<string>('INTERNAL_PROXY_SECRET') || undefined;
    this.internalProxySecretDigest = secret ? sha256(secret) : undefined;
  }

  /**
   * Returns the tracker key the throttler counts against. Uses the forwarded
   * browser IP only when the request proves it came from the trusted `web` caller
   * (correct secret) AND supplies a syntactically valid IP; otherwise falls back
   * to `req.ip` — identical to the stock guard.
   */
  protected async getTracker(req: TrackedRequest): Promise<string> {
    const forwardedIp = this.resolveTrustedForwardedIp(req);
    if (forwardedIp) {
      return forwardedIp;
    }
    // Deliberately `req.ip ?? ''` rather than the stock guard's bare `req.ip`
    // (which is `undefined` when Express hasn't resolved an IP): coalescing
    // to `''` buckets every such request under one shared key instead of a
    // `"...-undefined"` string key, and is unreachable in practice once
    // `trust proxy` is set in main.ts (Express always populates `req.ip`).
    return req.ip ?? '';
  }

  /**
   * Resolves a trustworthy forwarded client IP, or `null` when any precondition
   * fails (feature disabled, secret missing/wrong, IP header missing/malformed/
   * multi-valued). Returning `null` is the signal to fall back to `req.ip`.
   */
  private resolveTrustedForwardedIp(req: TrackedRequest): string | null {
    const secretDigest = this.internalProxySecretDigest;
    if (!secretDigest) {
      return null;
    }
    const headers = req.headers ?? {};

    const providedSecret = headers[PROXY_SECRET_HEADER];
    if (
      typeof providedSecret !== 'string' ||
      !timingSafeEqual(sha256(providedSecret), secretDigest)
    ) {
      return null;
    }

    const forwardedIp = headers[FORWARDED_CLIENT_IP_HEADER];
    // `net.isIP` returns 0 for anything that is not a valid IPv4/IPv6 address —
    // never trust a malformed value an attacker (or a bug) might inject.
    if (typeof forwardedIp !== 'string' || isIP(forwardedIp) === 0) {
      return null;
    }

    return forwardedIp;
  }
}

/**
 * SHA-256 digest of a string, as a fixed-length (32-byte) `Buffer`. Comparing
 * digests rather than raw secret bytes means every `timingSafeEqual` call in
 * this file has two guaranteed-equal-length inputs by construction — no
 * length branch is needed, so there is no length-timing side channel (unlike
 * a raw length-guard-then-compare, which would let an attacker learn the
 * secret's byte length by timing the two code paths against each other).
 */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
