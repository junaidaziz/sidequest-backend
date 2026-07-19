import { forwardRef, Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EmailModule } from '../email/email.module';
import { AdminManagementController } from './admin-management.controller';
import { AdminManagementService } from './admin-management.service';
import { PermissionGuard } from './guards/permission.guard';
import { PermissionResolverService } from './permission-resolver.service';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

/**
 * RBAC module: the @RequirePermission decorator + PermissionGuard, the Redis-cached
 * effective-permission resolver, and admin-user / role / permission management.
 *
 * Imports AdminAuthModule (for the admin-jwt guard/strategy + AdminAuthService +
 * AdminMfaService) and AuditLogModule via forwardRef (audit-log's viewer needs
 * this module's PermissionGuard, while this module needs AuditLogService — an
 * intentional, resolved cycle). Exports the guard + resolver so any admin module
 * can permission-gate its own routes.
 */
@Module({
  imports: [AdminAuthModule, EmailModule, forwardRef(() => AuditLogModule)],
  controllers: [AdminManagementController, RoleController],
  providers: [PermissionResolverService, PermissionGuard, AdminManagementService, RoleService],
  exports: [PermissionResolverService, PermissionGuard],
})
export class RbacModule {}
