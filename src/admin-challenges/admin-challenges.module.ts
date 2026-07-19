import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MissionsModule } from '../missions/missions.module';
import { AdminChallengesController } from './admin-challenges.controller';
import { AdminChallengesService } from './admin-challenges.service';

/**
 * Admin challenge (Mission) management (Phase 9) — CRUD plus the
 * publish/unpublish/archive/feature/duplicate lifecycle for the curated pool.
 *
 * Gated by the new RBAC system, NOT the legacy `AdminGuard`. PrismaService is
 * global; `PermissionGuard`/resolver come from the @Global RbacModule and the
 * 'admin-jwt' strategy is registered process-wide by AdminAuthModule — so none of
 * those are imported here (mirrors AdminModule/CmsModule wiring). AuditLogModule
 * supplies the audit trail; MissionsModule is imported for its exported
 * `MissionPoolService`, whose cache must be invalidated whenever a mission's
 * generator visibility (`isActive`) changes.
 */
@Module({
  imports: [AuditLogModule, MissionsModule],
  controllers: [AdminChallengesController],
  providers: [AdminChallengesService],
})
export class AdminChallengesModule {}
