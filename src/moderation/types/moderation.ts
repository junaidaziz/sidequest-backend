import { ModerationActionType } from '@prisma/client';

/**
 * Discriminates the two existing submission types the unified moderation queue
 * surfaces. The queue is a read-only aggregation over `Completion` (mission proof)
 * and `UserTaskSubmission` (peer-to-peer challenge evidence) — it is NOT a new
 * data model, so this enum lives only in the API layer, not the schema.
 */
export enum ModerationQueueSource {
  /** A mission-proof `Completion` awaiting review (`verificationStatus: Pending`). */
  Completion = 'completion',
  /** A peer-to-peer `UserTaskSubmission` awaiting review (`status: Submitted`). */
  TaskSubmission = 'task_submission',
}

/**
 * Per-request audit context threaded from the controller (the acting admin plus
 * the request's IP / user agent) — identical shape to the other admin modules'
 * action contexts, kept local so the moderation module owns its own type.
 */
export interface ModerationActionContext {
  actorAdminUserId: string;
  ipAddress: string;
  userAgent: string | null;
}

/**
 * The `ModerationActionType` values that act on a *user* (as opposed to a piece of
 * content). These require a resolvable target user and — for suspend/ban/reinstate
 * — reuse the Phase 8 `AdminUsersService` suspend/reactivate mechanism rather than
 * introducing a second, parallel suspension flag.
 */
export const USER_DIRECTED_ACTIONS: readonly ModerationActionType[] = [
  ModerationActionType.WarnUser,
  ModerationActionType.SuspendUser,
  ModerationActionType.BanUser,
  ModerationActionType.ReinstateUser,
];

/**
 * The `ModerationActionType` values that hide, remove, or restore a piece of
 * reported *content*. These additionally require the `moderation.remove_content`
 * permission (checked in the service via the effective-permission resolver),
 * matching the seeded catalog's separation of "take action" from "remove content".
 */
export const CONTENT_DIRECTED_ACTIONS: readonly ModerationActionType[] = [
  ModerationActionType.HideContent,
  ModerationActionType.RemoveContent,
  ModerationActionType.ReinstateContent,
];
