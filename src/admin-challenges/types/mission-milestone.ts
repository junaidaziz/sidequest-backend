/**
 * The shape of a single entry in `Mission.milestones` (stored as `Json?`). Used
 * as the explicit contract for both the input DTO (`MissionMilestoneDto`, which
 * implements this) and the admin response DTO — so the public API surface never
 * leaks the Prisma-internal `JsonValue` type.
 *
 * Kept in a module-local `types/` file per the codebase convention (audit-log,
 * admin-auth) that ad-hoc interfaces live under `types/`, not inline in the DTO.
 */
export interface MissionMilestone {
  /** Short milestone/checkpoint label. */
  title: string;
  /** Optional longer milestone detail. */
  description?: string;
  /** Optional explicit ordering hint (0-based). */
  order?: number;
}
