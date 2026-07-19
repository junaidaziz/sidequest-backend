import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionResolverService } from '../permission-resolver.service';

/**
 * Runs AFTER AdminJwtAuthGuard (which attaches the AuthAdmin to the request).
 * Enforces two things on any @RequirePermission-annotated route:
 *  1. Onboarding gate — an admin who must still change their password, or who is
 *     in an MFA-required role but hasn't enrolled, is blocked from every
 *     permission-gated route (routed to the enrollment/change flow instead). The
 *     self-service admin-auth routes are un-annotated and therefore stay reachable.
 *  2. Effective-permission check — resolves the admin's cached permission set and
 *     requires ALL listed keys, else 403.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthAdmin }>();
    const admin = request.user;
    if (!admin) {
      throw new UnauthorizedException('Not authenticated');
    }

    if (admin.mustChangePassword) {
      throw new ForbiddenException('Password change required before using the admin portal');
    }
    if (admin.mfaPending) {
      throw new ForbiddenException('MFA enrollment required before using the admin portal');
    }

    const allowed = await this.resolver.hasAll(admin.adminUserId, required);
    if (!allowed) {
      throw new ForbiddenException(`Missing required permission: ${required.join(', ')}`);
    }
    return true;
  }
}
