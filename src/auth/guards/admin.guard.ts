import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/** Header carrying the shared admin secret for the (userless) admin routes. */
export const ADMIN_KEY_HEADER = 'x-admin-key';

/** Config key for the shared admin secret. */
export const ADMIN_API_KEY_ENV = 'ADMIN_API_KEY';

/**
 * Gates the admin verification route behind a shared secret sent in the
 * `x-admin-key` header. There is no per-admin user identity in this system yet;
 * this is intentionally a single shared key, not RBAC.
 *
 * Fail-closed: if ADMIN_API_KEY is unset or empty the guard denies every
 * request rather than falling open to "no auth required". `config.get` (not
 * `getOrThrow`) is used deliberately so a missing key yields a clean 403 here
 * instead of crashing the app at boot.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>(ADMIN_API_KEY_ENV);
    if (typeof expected !== 'string' || expected.length === 0) {
      throw new ForbiddenException('Admin access is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[ADMIN_KEY_HEADER];
    if (typeof provided !== 'string' || provided !== expected) {
      throw new ForbiddenException('Invalid admin key');
    }

    return true;
  }
}
