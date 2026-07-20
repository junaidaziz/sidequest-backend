import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/**
 * Admin moderation (Phase 10): unified proof/submission review queue plus the
 * Report / ModerationAction / Appeal workflow, and the RBAC-gated proof-review
 * route that supersedes the legacy shared-key `AdminGuard` completion route.
 *
 * Gated by the new RBAC system, NOT the legacy `AdminGuard`. PrismaService is
 * global; `PermissionGuard`/`PermissionResolverService` come from the @Global
 * RbacModule and the 'admin-jwt' strategy is registered process-wide by
 * AdminAuthModule — so none of those are imported here (mirrors AdminModule/
 * AdminChallengesModule wiring). AuditLogModule supplies the audit trail;
 * StorageModule presigns proof/evidence media in the queue; AdminModule is imported
 * for its exported `AdminUsersService`, whose Phase 8 suspend/reactivate logic is
 * REUSED (not duplicated) for suspension/ban and appeal-driven reinstatement.
 */
@Module({
  imports: [AdminModule, AuditLogModule, StorageModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
