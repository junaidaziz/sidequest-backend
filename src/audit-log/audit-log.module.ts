import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/**
 * Audit trail module — a true leaf (no module imports). AuditLogService is
 * consumed by admin-auth and rbac. The read-only viewer controller uses
 * AdminJwtAuthGuard and the rbac PermissionGuard, but neither needs a module
 * import here: the 'admin-jwt' strategy is registered process-wide by
 * AdminAuthModule, and PermissionGuard + its resolver come from the @Global
 * RbacModule. Keeping this module import-free is what makes the graph acyclic.
 */
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
