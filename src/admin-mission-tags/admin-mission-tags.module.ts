import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AdminMissionTagsController } from './admin-mission-tags.controller';
import { AdminMissionTagsService } from './admin-mission-tags.service';

/**
 * Admin-managed mission tag vocabulary (closed-beta admin tooling). Gated by the
 * RBAC system; PermissionGuard/resolver come from the @Global RbacModule and the
 * 'admin-jwt' strategy is registered process-wide by AdminAuthModule, so neither
 * is imported here (mirrors AdminModule/CmsModule wiring). PrismaService is global.
 * AuditLogModule provides the audit trail for tag mutations.
 */
@Module({
  imports: [AuditLogModule],
  controllers: [AdminMissionTagsController],
  providers: [AdminMissionTagsService],
})
export class AdminMissionTagsModule {}
