import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guards admin-portal routes with the 'admin-jwt' Passport strategy. Distinct
 * from the user-facing JwtAuthGuard ('jwt') — the two never overlap.
 * `@UseGuards(AdminJwtAuthGuard, PermissionGuard)` is the standard admin combo.
 */
@Injectable()
export class AdminJwtAuthGuard extends AuthGuard('admin-jwt') {}
