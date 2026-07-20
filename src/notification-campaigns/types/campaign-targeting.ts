import { Prisma } from '@prisma/client';

/**
 * Per-request audit context threaded from the controller (the acting admin plus
 * the request's IP / user agent) — identical shape to the other admin modules'
 * action contexts, kept local so the campaigns module owns its own type.
 */
export interface CampaignActionContext {
  actorAdminUserId: string;
  ipAddress: string;
  userAgent: string | null;
}

/**
 * Structured targeting criteria for a campaign, persisted verbatim on
 * `NotificationCampaign.targetFilter` (Json) and resolved to a concrete `User`
 * set at send time by {@link buildTargetWhere}.
 *
 * Only dimensions with real backing data in the schema are modelled. The product
 * requirements list eight targeting dimensions; the following two are DELIBERATELY
 * OMITTED because no column exists for them anywhere in the schema, and this
 * project's convention is to flag such gaps rather than fake a no-op filter:
 *   - **Country**   — no country/locale column exists on `User` or anywhere else.
 *   - **App version** — no app-version column exists anywhere.
 * Do not add fields for these without a real schema column to back them.
 *
 * "Notification preferences" is intentionally NOT a field here either: marketing
 * opt-out is a *delivery gate* applied per-recipient at send time
 * (`NotificationPreference.marketingEnabled`), never a targeting criterion.
 */
export interface CampaignTargetFilter {
  /** Registered on/after this instant (`User.createdAt >=`). ISO-8601. */
  registeredAfter?: string;
  /** Registered on/before this instant (`User.createdAt <=`). ISO-8601. */
  registeredBefore?: string;
  /** Minimum lifetime XP (`User.totalXp >=`). Level is derived from totalXp at
   * read time elsewhere, so we filter on the raw XP range, not a "level" column. */
  minTotalXp?: number;
  /** Maximum lifetime XP (`User.totalXp <=`). */
  maxTotalXp?: number;
  /** Restrict to guest sessions (`true`) or full accounts (`false`). */
  isGuest?: boolean;
  /** Recently active: last completion on/after this instant
   * (`User.lastCompletionDate >=`). ISO-8601. */
  activeSince?: string;
  /** Dormant: last completion strictly before this instant, OR never completed
   * (`User.lastCompletionDate < X OR IS NULL`). ISO-8601. */
  inactiveSince?: string;
  /** Whether the user has participated (>=1 `Completion` row). `true` => has at
   * least one completion; `false` => none. A documented proxy for
   * "challenge/mission participation". */
  hasParticipated?: boolean;
  /**
   * IMPERFECT PROXY, not a true per-user platform: `User` has no platform column,
   * and `PushToken.platform` is per-device (a user may have zero, one, or several
   * devices across platforms). This resolves to "has at least one *enabled* push
   * token on platform X", nothing stronger.
   */
  pushPlatform?: CampaignPushPlatform;
}

/** The two device platforms a push token can report (`PushToken.platform`). */
export enum CampaignPushPlatform {
  Ios = 'ios',
  Android = 'android',
}

/**
 * Resolves a {@link CampaignTargetFilter} to a Prisma `User` where-clause.
 *
 * Two invariants are baked in unconditionally, so the preview count and the
 * send-time recipient resolution are always identical (they call this same
 * function): soft-deleted (`deletedAt`) and suspended (`suspendedAt`) accounts
 * are NEVER messaged, whatever the filter says. A null/absent filter therefore
 * targets "every live, non-suspended user".
 */
export function buildTargetWhere(
  filter: CampaignTargetFilter | null | undefined,
): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { deletedAt: null, suspendedAt: null };
  if (!filter) {
    return where;
  }

  if (filter.registeredAfter || filter.registeredBefore) {
    where.createdAt = {};
    if (filter.registeredAfter) {
      where.createdAt.gte = new Date(filter.registeredAfter);
    }
    if (filter.registeredBefore) {
      where.createdAt.lte = new Date(filter.registeredBefore);
    }
  }

  if (filter.minTotalXp !== undefined || filter.maxTotalXp !== undefined) {
    where.totalXp = {};
    if (filter.minTotalXp !== undefined) {
      where.totalXp.gte = filter.minTotalXp;
    }
    if (filter.maxTotalXp !== undefined) {
      where.totalXp.lte = filter.maxTotalXp;
    }
  }

  if (filter.isGuest !== undefined) {
    where.isGuest = filter.isGuest;
  }

  if (filter.activeSince) {
    where.lastCompletionDate = { gte: new Date(filter.activeSince) };
  }

  if (filter.inactiveSince) {
    // "Inactive" includes users who have never completed anything (null), so an
    // OR is required rather than a simple `lt` (which would exclude nulls).
    where.OR = [
      { lastCompletionDate: { lt: new Date(filter.inactiveSince) } },
      { lastCompletionDate: null },
    ];
  }

  if (filter.hasParticipated !== undefined) {
    where.completions = filter.hasParticipated ? { some: {} } : { none: {} };
  }

  if (filter.pushPlatform) {
    where.pushTokens = { some: { platform: filter.pushPlatform, disabledAt: null } };
  }

  return where;
}
