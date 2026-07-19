import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { CmsAnnouncementController } from './controllers/cms-announcement.controller';
import { CmsFaqController } from './controllers/cms-faq.controller';
import { CmsLinkController } from './controllers/cms-link.controller';
import { CmsPageController } from './controllers/cms-page.controller';
import { CmsPublicController } from './controllers/cms-public.controller';
import { CmsScreenshotController } from './controllers/cms-screenshot.controller';
import { CmsSectionController } from './controllers/cms-section.controller';
import { CmsTestimonialController } from './controllers/cms-testimonial.controller';
import { CmsAnnouncementService } from './services/cms-announcement.service';
import { CmsAssetService } from './services/cms-asset.service';
import { CmsCacheService } from './services/cms-cache.service';
import { CmsFaqService } from './services/cms-faq.service';
import { CmsLinkService } from './services/cms-link.service';
import { CmsPageService } from './services/cms-page.service';
import { CmsPublicService } from './services/cms-public.service';
import { CmsRevalidationService } from './services/cms-revalidation.service';
import { CmsScreenshotService } from './services/cms-screenshot.service';
import { CmsSectionService } from './services/cms-section.service';
import { CmsTestimonialService } from './services/cms-testimonial.service';

/**
 * CMS module (Phase 7). Permission-gated admin CRUD/publish/reorder for every
 * content type plus an unauthenticated, Redis-cached public read surface and a
 * best-effort revalidation-webhook trigger.
 *
 * Depends on the global PrismaModule/RedisModule (source-of-truth + public cache)
 * and imports StorageModule (CMS asset upload) and AuditLogModule (every mutation
 * is audited). PermissionGuard + the effective-permission resolver come from the
 * @Global RbacModule; the 'admin-jwt' strategy behind AdminJwtAuthGuard is
 * registered process-wide by AdminAuthModule — so neither needs importing here,
 * mirroring the audit-log module's wiring and keeping the graph acyclic.
 */
@Module({
  imports: [StorageModule, AuditLogModule],
  controllers: [
    CmsPageController,
    CmsSectionController,
    CmsFaqController,
    CmsTestimonialController,
    CmsScreenshotController,
    CmsAnnouncementController,
    CmsLinkController,
    CmsPublicController,
  ],
  providers: [
    CmsCacheService,
    CmsRevalidationService,
    CmsAssetService,
    CmsPageService,
    CmsSectionService,
    CmsFaqService,
    CmsTestimonialService,
    CmsScreenshotService,
    CmsAnnouncementService,
    CmsLinkService,
    CmsPublicService,
  ],
})
export class CmsModule {}
