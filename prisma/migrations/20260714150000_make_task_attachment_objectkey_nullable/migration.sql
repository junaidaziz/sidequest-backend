-- M22.2 (account deletion): allow UserTaskAttachment.objectKey to be nulled in
-- place when the submitting user soft-deletes their account, so the DB pointer
-- to their evidence media can be de-referenced synchronously (mirroring how
-- Completion.proofKey / User.avatarUrl are nulled) before a best-effort S3
-- object delete. Backward-compatible: existing rows keep their non-null keys.
ALTER TABLE "UserTaskAttachment" ALTER COLUMN "objectKey" DROP NOT NULL;
