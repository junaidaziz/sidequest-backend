import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CmsRevalidationService } from '../cms/services/cms-revalidation.service';
import { AppConfigPublicController } from './app-config-public.controller';
import { AppConfigController } from './app-config.controller';
import { AppConfigService } from './app-config.service';

/**
 * Application configuration module (Phase 7). Admin CRUD (permission-gated) plus
 * an unauthenticated public read of allow-listed keys.
 *
 * Reuses the stateless CmsRevalidationService (a bare ConfigService consumer) to
 * ping the web app when a public key changes — provided locally rather than
 * importing CmsModule to avoid coupling the two modules. Prisma/Redis are global;
 * AuditLogModule supplies the audit writer.
 */
@Module({
  imports: [AuditLogModule],
  controllers: [AppConfigController, AppConfigPublicController],
  providers: [AppConfigService, CmsRevalidationService],
})
export class AppConfigModule {}
