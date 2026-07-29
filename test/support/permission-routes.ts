import 'reflect-metadata';
import { RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRE_PERMISSION_KEY } from '../../src/rbac/decorators/require-permission.decorator';

// --- Every controller registered in AppModule, imported directly. -----------
// The permission REQUIREMENT for each route is NEVER hand-typed here — it is
// read live from each handler's `@RequirePermission` metadata via
// `Reflect.getMetadata` below (the same metadata `PermissionGuard` reads at
// request time). Only the controller-class LIST is enumerated by a human, and
// the e2e spec cross-checks that list against NestJS's own `DiscoveryService`
// at boot so adding a new controller without listing it here fails the suite.
import { AppController } from '../../src/app.controller';
import { AuthController } from '../../src/auth/auth.controller';
import { UsersController } from '../../src/users/users.controller';
import { MissionsController } from '../../src/missions/missions.controller';
import { ProofController } from '../../src/proof/proof.controller';
import { MediaController } from '../../src/media/media.controller';
import { HomeController } from '../../src/home/home.controller';
import { PaymentController } from '../../src/payment/payment.controller';
import { TasksController } from '../../src/tasks/tasks.controller';
import { ReferralsController } from '../../src/referrals/referrals.controller';
import { NotificationsController } from '../../src/notifications/notifications.controller';
import { AdminUsersController } from '../../src/admin/admin-users.controller';
import { AdminAuthController } from '../../src/admin-auth/admin-auth.controller';
import { RoleController } from '../../src/rbac/role.controller';
import { AdminManagementController } from '../../src/rbac/admin-management.controller';
import { AuditLogController } from '../../src/audit-log/audit-log.controller';
import { CmsAnnouncementController } from '../../src/cms/controllers/cms-announcement.controller';
import { CmsFaqController } from '../../src/cms/controllers/cms-faq.controller';
import { CmsLinkController } from '../../src/cms/controllers/cms-link.controller';
import { CmsPageController } from '../../src/cms/controllers/cms-page.controller';
import { CmsPublicController } from '../../src/cms/controllers/cms-public.controller';
import { CmsScreenshotController } from '../../src/cms/controllers/cms-screenshot.controller';
import { CmsSectionController } from '../../src/cms/controllers/cms-section.controller';
import { CmsTestimonialController } from '../../src/cms/controllers/cms-testimonial.controller';
import { AppConfigController } from '../../src/app-config/app-config.controller';
import { AppConfigPublicController } from '../../src/app-config/app-config-public.controller';
import { AdminChallengesController } from '../../src/admin-challenges/admin-challenges.controller';
import { AdminMissionTagsController } from '../../src/admin-mission-tags/admin-mission-tags.controller';
import { ModerationController } from '../../src/moderation/moderation.controller';
import { ReportsController } from '../../src/moderation/reports.controller';
import { NotificationCampaignsController } from '../../src/notification-campaigns/notification-campaigns.controller';
import { AnalyticsController } from '../../src/analytics/analytics.controller';
import { ContactController } from '../../src/contact/contact.controller';
import { AdminContactController } from '../../src/contact/admin-contact.controller';

/** The full set of controllers the matrix walks. Cross-checked at boot. */
export const ALL_CONTROLLERS: Type<unknown>[] = [
  AppController,
  AuthController,
  UsersController,
  MissionsController,
  ProofController,
  MediaController,
  HomeController,
  PaymentController,
  TasksController,
  ReferralsController,
  NotificationsController,
  AdminUsersController,
  AdminAuthController,
  RoleController,
  AdminManagementController,
  AuditLogController,
  CmsAnnouncementController,
  CmsFaqController,
  CmsLinkController,
  CmsPageController,
  CmsPublicController,
  CmsScreenshotController,
  CmsSectionController,
  CmsTestimonialController,
  AppConfigController,
  AppConfigPublicController,
  AdminChallengesController,
  AdminMissionTagsController,
  ModerationController,
  ReportsController,
  NotificationCampaignsController,
  AnalyticsController,
  ContactController,
  AdminContactController,
];

/** supertest-callable lowercase HTTP verb. */
export type HttpVerb = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

export interface DiscoveredRoute {
  /** Owning controller class name (for reporting). */
  controllerName: string;
  /** Handler method name on the controller (for reporting). */
  handlerName: string;
  /** Lowercase HTTP verb, ready to pass to supertest. */
  method: HttpVerb;
  /** Declared route template, e.g. `/admin/roles/:id/permissions`. */
  fullPath: string;
  /** Route with path params substituted, ready for a real HTTP request. */
  requestPath: string;
  /**
   * The permission keys required by this route's live `@RequirePermission`
   * metadata (ALL semantics). Empty array => the route carries no
   * `@RequirePermission` and is ungated.
   */
  permissions: string[];
}

/** Concrete value for `:param` segments — a syntactically valid but absent UUID. */
const PARAM_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

const VERB_BY_REQUEST_METHOD: Partial<Record<RequestMethod, HttpVerb>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.OPTIONS]: 'options',
  [RequestMethod.HEAD]: 'head',
};

function toStringPath(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Joins a controller base path and a handler path into a single leading-slash path. */
function joinPaths(base: unknown, route: unknown): string {
  const segments = [toStringPath(base), toStringPath(route)]
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment.length > 0);
  return `/${segments.join('/')}`;
}

/** Substitutes `:param` and `*` segments so the path can be requested for real. */
function substituteParams(fullPath: string): string {
  return fullPath
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        return PARAM_PLACEHOLDER;
      }
      if (segment === '*' || segment.startsWith('*')) {
        return 'wildcard';
      }
      return segment;
    })
    .join('/');
}

/**
 * Walks every listed controller's route handlers and reads each one's HTTP
 * method, path, and `@RequirePermission` metadata straight off the decorator
 * metadata — the single source of truth the guard itself uses. Returns a
 * deterministically-ordered list so generated test names are stable.
 */
export function discoverRoutes(controllers: Type<unknown>[] = ALL_CONTROLLERS): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  for (const controller of controllers) {
    const basePath: unknown = Reflect.getMetadata(PATH_METADATA, controller);
    const prototype = controller.prototype as Record<string, unknown>;
    const classPermissions: string[] | undefined = Reflect.getMetadata(
      REQUIRE_PERMISSION_KEY,
      controller,
    );

    for (const handlerName of Object.getOwnPropertyNames(prototype)) {
      if (handlerName === 'constructor') {
        continue;
      }
      const handler = prototype[handlerName];
      if (typeof handler !== 'function') {
        continue;
      }
      const requestMethod: RequestMethod | undefined = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      );
      if (requestMethod === undefined) {
        continue; // not a route handler
      }
      const verb = VERB_BY_REQUEST_METHOD[requestMethod];
      if (!verb) {
        continue; // ALL / non-standard verbs are not part of this app's surface
      }

      const routePath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      const fullPath = joinPaths(basePath, routePath);

      // Mirror `Reflector.getAllAndOverride([handler, class])`: handler metadata
      // wins, else fall back to any controller-level `@RequirePermission`.
      const handlerPermissions: string[] | undefined = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        handler,
      );
      const permissions = handlerPermissions ?? classPermissions ?? [];

      routes.push({
        controllerName: controller.name,
        handlerName,
        method: verb,
        fullPath,
        requestPath: substituteParams(fullPath),
        permissions,
      });
    }
  }

  return routes.sort((a, b) =>
    a.fullPath === b.fullPath
      ? a.method.localeCompare(b.method)
      : a.fullPath.localeCompare(b.fullPath),
  );
}

/** Stable signature for a permission SET (order-independent) used to key roles/tokens. */
export function permissionSignature(permissions: string[]): string {
  return [...permissions].sort().join('+');
}
