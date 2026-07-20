import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Admin surface. Two coexisting, deliberately separate gates:
 *  - `AdminController` — the legacy shared-key (`AdminGuard`/`x-admin-key`)
 *    completion-verification route, untouched here (its RBAC cutover is Phase 10).
 *  - `AdminUsersController` — Phase 8 end-user management, gated by the new RBAC
 *    system (`AdminJwtAuthGuard` + `PermissionGuard`).
 *
 * PrismaService is global via PrismaModule; `PermissionGuard`/resolver come from
 * the @Global RbacModule and the 'admin-jwt' strategy is registered process-wide
 * by AdminAuthModule — so neither is imported here (mirrors CmsModule's wiring).
 * AuthModule is imported so admin-initiated deletion reuses
 * `AuthService.anonymizeUserAccount`; AuditLogModule for the audit trail;
 * StorageModule to presign proof/avatar keys in the profile view and export.
 */
@Module({
  imports: [AuthModule, AuditLogModule, StorageModule],
  controllers: [AdminController, AdminUsersController],
  providers: [AdminService, AdminUsersService],
  // AdminUsersService is exported so the Phase 10 moderation module can REUSE its
  // Phase 8 suspend/reactivate logic (the one that nulls refreshTokenHash and that
  // JwtStrategy checks) rather than duplicating a parallel suspension flow.
  exports: [AdminUsersService],
})
export class AdminModule {}
