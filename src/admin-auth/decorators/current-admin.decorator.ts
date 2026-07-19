import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthAdmin } from '../types/admin-jwt-payload.interface';

/**
 * Extracts the authenticated admin principal the admin-jwt strategy attached to
 * the request. Only meaningful on routes guarded by AdminJwtAuthGuard.
 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthAdmin => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthAdmin }>();
    return request.user;
  },
);
