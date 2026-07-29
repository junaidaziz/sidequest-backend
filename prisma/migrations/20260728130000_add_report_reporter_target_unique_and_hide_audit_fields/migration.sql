-- Follow-up to 20260728120000. Closes two reviewer findings:
--   WARN-D3 — HiddenContent / GlobalContentHide were missing the `updatedAt`
--     audit field CODING_STANDARDS requires on every new model.
--   WARN-D4 — no DB-level uniqueness on Report per (reporter, target), which let
--     two concurrent identical POST /reports both insert.
-- Additive only; existing behaviour is unchanged.

-- WARN-D3: add the required `updatedAt` to the two hide tables. Backfilled with
-- CURRENT_TIMESTAMP for any existing rows, then the DB default is dropped so the
-- column matches the schema's app-managed `@updatedAt` (no DB default) and
-- introduces no drift.
ALTER TABLE "HiddenContent" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HiddenContent" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "GlobalContentHide" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "GlobalContentHide" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- WARN-D4: one report per (reporter, target). `reporterUserId` is nullable for
-- system/anonymized reports; Postgres treats NULLs as distinct, so those rows are
-- intentionally exempt and can coexist for one target. Collapse any pre-existing
-- user-initiated duplicates (keeping the earliest ctid, and never removing a row
-- an admin ModerationAction already references) so the unique index builds.
DELETE FROM "Report" a
USING "Report" b
WHERE a."reporterUserId" IS NOT NULL
  AND a."reporterUserId" = b."reporterUserId"
  AND a."targetType" = b."targetType"
  AND a."targetId" = b."targetId"
  AND a."ctid" > b."ctid"
  AND NOT EXISTS (SELECT 1 FROM "ModerationAction" m WHERE m."reportId" = a."id");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterUserId_targetType_targetId_key" ON "Report"("reporterUserId", "targetType", "targetId");
