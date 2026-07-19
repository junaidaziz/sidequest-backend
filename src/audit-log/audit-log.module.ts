import { forwardRef, Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/**
 * Audit trail module. AuditLogService is a leaf consumed by admin-auth and rbac;
 * the read-only viewer controller depends on the rbac PermissionGuard, so
 * RbacModule is imported via forwardRef to resolve the (intentional) module
 * cycle: rbac needs AuditLogService, audit-log needs the permission guard.
 */
@Module({
  imports: [AdminAuthModule, forwardRef(() => RbacModule)],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
