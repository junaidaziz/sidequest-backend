-- Adds indexes backing admin-facing default sort/filter columns identified by the
-- performance audit. All additive, non-breaking. Grouped into one migration.

-- Moderation queue: UserTaskSubmission is filtered by `status = 'Submitted'` and
-- ordered by `submittedAt desc` (ModerationService.getQueue). Composite so one
-- index serves both the equality filter and the sort — mirrors the existing
-- "completions_verificationStatus_idx" precedent for the analogous
-- Completion.verificationStatus queue query.
-- CreateIndex
CREATE INDEX "UserTaskSubmission_status_submittedAt_idx" ON "UserTaskSubmission"("status", "submittedAt");

-- Admin user list: default orderBy createdAt desc + registeredFrom/registeredTo range filter.
-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- Admin challenge list: default orderBy updatedAt desc.
-- CreateIndex
CREATE INDEX "missions_updatedAt_idx" ON "missions"("updatedAt");

-- Notification campaign list: default orderBy createdAt desc.
-- CreateIndex
CREATE INDEX "NotificationCampaign_createdAt_idx" ON "NotificationCampaign"("createdAt");
