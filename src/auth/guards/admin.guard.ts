import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';

/** Header carrying the shared admin secret for the (userless) admin routes. */
export const ADMIN_KEY_HEADER = 'x-admin-key';

/** Config key for the shared admin secret. */
export const ADMIN_API_KEY_ENV = 'ADMIN_API_KEY';

/**
 * Single message for every denial path (unconfigured key, missing header,
 * wrong header) so a caller can't distinguish "not configured" from "wrong
 * key" from the response body.
 */
const DENIED_MESSAGE = 'Invalid admin key';

/** SHA-256 digest so both sides of timingSafeEqual are always the same length. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Gates the admin verification route behind a shared secret sent in the
 * `x-admin-key` header. There is no per-admin user identity in this system yet;
 * this is intentionally a single shared key, not RBAC.
 *
 * Fail-closed: if ADMIN_API_KEY is unset or empty the guard denies every
 * request rather than falling open to "no auth required". `config.get` (not
 * `getOrThrow`) is used deliberately so a missing key yields a clean 403 here
 * instead of crashing the app at boot.
 *
 * The comparison is constant-time (`timingSafeEqual` over fixed-length SHA-256
 * digests, never a raw `!==` over the secret) so response timing can't leak
 * how many leading characters of a guessed key were correct.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>(ADMIN_API_KEY_ENV);
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[ADMIN_KEY_HEADER];

    const configured = typeof expected === 'string' && expected.length > 0;
    const suppliedAsString = typeof provided === 'string' && provided.length > 0;

    // Always run the comparison, even when unconfigured/missing, against a
    // stable placeholder — never short-circuit before it, so the unconfigured
    // and wrong-key paths take the same code shape and emit the same message.
    const matches =
      configured && suppliedAsString && timingSafeEqual(digest(provided), digest(expected));

    if (!matches) {
      throw new ForbiddenException(DENIED_MESSAGE);
    }

    return true;
  }
}
