import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { EmailModule } from '../email/email.module';
import { AdminContactController } from './admin-contact.controller';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

/**
 * Contact-form module (closed-beta admin tooling): one public intake controller
 * (`POST /contact`) plus the RBAC-gated admin triage controller
 * (`/admin/contact-submissions`), sharing one service. EmailModule provides the
 * best-effort notification email; AuditLogModule the admin-action trail.
 * PermissionGuard/resolver come from the @Global RbacModule and the 'admin-jwt'
 * strategy from AdminAuthModule, so neither is imported here (mirrors AdminModule).
 */
@Module({
  imports: [EmailModule, AuditLogModule],
  controllers: [ContactController, AdminContactController],
  providers: [ContactService],
})
export class ContactModule {}
