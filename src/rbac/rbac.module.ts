import { Global, Module } from '@nestjs/common';
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
 * @Global (like PrismaModule/RedisModule) so its PermissionGuard + resolver are
 * available to any admin module that permission-gates a route — notably the
 * audit-log viewer — WITHOUT that module having to import RbacModule. That is what
 * keeps the module graph acyclic: rbac depends on admin-auth + audit-log, and
 * nothing depends back on rbac via a file-level import.
 */
@Global()
@Module({
  imports: [AdminAuthModule, EmailModule, AuditLogModule],
  controllers: [AdminManagementController, RoleController],
  providers: [PermissionResolverService, PermissionGuard, AdminManagementService, RoleService],
  exports: [PermissionResolverService, PermissionGuard],
})
export class RbacModule {}
