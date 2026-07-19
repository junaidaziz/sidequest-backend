/**
 * Admin user-management constants (Phase 8, web platform).
 *
 * These back the admin-facing moderation surface over the mobile-app `User`
 * table. Kept deliberately small: the spec asks for a simple per-user feature
 * restriction toggle and a status filter, not a second permission system.
 */

/**
 * Derived account status used by the `GET /admin/users` status filter and the
 * response DTOs. It is not a stored column — it is computed from the existing
 * `deletedAt` and the new `suspendedAt` flags:
 *   - `deleted`   → `deletedAt` set (takes precedence over suspension)
 *   - `suspended` → `suspendedAt` set and not deleted
 *   - `active`    → neither set
 */
export enum UserAccountStatus {
  Active = 'active',
  Suspended = 'suspended',
  Deleted = 'deleted',
}

/**
 * The closed allow-list of feature keys an admin may restrict on an individual
 * user via `PATCH /admin/users/:id/restrict`. Stored as a `String[]` on
 * `User.restrictedFeatures`. Chosen to map onto real, existing product surfaces
 * rather than invented ones:
 *   - `proof_submission`       → submitting mission proof (`POST /missions/:id/proof`)
 *   - `challenge_creation`     → creating peer tasks/challenges (`POST /tasks`)
 *   - `challenge_participation`→ accepting/being invited to tasks
 *   - `referrals`              → sending referral invites (`POST /referrals/invites`)
 *   - `avatar_upload`          → replacing the profile picture (`POST /users/me/avatar`)
 *
 * NOTE (documented, not silently done): this phase persists + exposes + audits
 * the restriction set. Per-feature *enforcement* (each feature module checking
 * this list before acting) is intentionally incremental and lands with those
 * modules — the field is the mechanism; wiring each endpoint to honor it is
 * out of scope here and flagged in the delivery report.
 */
export enum RestrictableFeature {
  ProofSubmission = 'proof_submission',
  ChallengeCreation = 'challenge_creation',
  ChallengeParticipation = 'challenge_participation',
  Referrals = 'referrals',
  AvatarUpload = 'avatar_upload',
}

/** Every known restriction key, for DTO validation and API documentation. */
export const RESTRICTABLE_FEATURES: readonly RestrictableFeature[] =
  Object.values(RestrictableFeature);
