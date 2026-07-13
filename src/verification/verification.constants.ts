/**
 * BullMQ queue that auto-approves a mission Completion after a timeout, unless a
 * manual admin override (PATCH /admin/completions/:id/verification) already
 * resolved it. Queue-name and job-name constants live here so the producer
 * (VerificationQueueService) and the consumer (VerificationProcessor) can never
 * drift apart on a hard-coded string.
 */
export const VERIFICATION_QUEUE = 'verification';

/** Job name for the delayed auto-approval of a still-Pending completion. */
export const AUTO_APPROVE_JOB = 'auto-approve';

/**
 * Env var (hours) controlling how long a completion stays Pending before the
 * auto-approve job flips it to Approved. Optional — defaults to 24h.
 */
export const AUTO_APPROVE_TIMEOUT_HOURS_ENV = 'PROOF_AUTO_APPROVE_TIMEOUT_HOURS';

/** Fallback used when the env var is unset or not a positive finite number. */
export const DEFAULT_AUTO_APPROVE_TIMEOUT_HOURS = 24;

/** Payload for an {@link AUTO_APPROVE_JOB} job — just the completion to re-check. */
export interface AutoApproveJobData {
  completionId: string;
}
