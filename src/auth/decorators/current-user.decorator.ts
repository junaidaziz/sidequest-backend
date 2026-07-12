import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../types/jwt-payload.interface';

/**
 * Extracts the authenticated principal that JwtStrategy attached to the request.
 * Only meaningful on routes guarded by JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return request.user;
  },
);
