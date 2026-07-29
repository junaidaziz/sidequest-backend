-- P0 gaps: (A) user-facing reporting with a reporter-local hide model plus
-- automatic global-hide escalation on a second distinct reporter, and (C) a
-- per-user IANA timezone so streaks can be computed on the user's LOCAL calendar
-- day instead of the UTC day. Additive only — no existing column is altered or
-- dropped, and existing rows keep the prior UTC-day behaviour (timezone defaults
-- to 'UTC').

-- AlterTable
ALTER TABLE "users" ADD COLUMN "timezone" TEXT DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "HiddenContent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalContentHide" (
    "id" TEXT NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalContentHide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HiddenContent_userId_targetType_targetId_key" ON "HiddenContent"("userId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "HiddenContent_userId_targetType_idx" ON "HiddenContent"("userId", "targetType");

-- CreateIndex
CREATE INDEX "HiddenContent_targetType_targetId_idx" ON "HiddenContent"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalContentHide_targetType_targetId_key" ON "GlobalContentHide"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "HiddenContent" ADD CONSTRAINT "HiddenContent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenContent" ADD CONSTRAINT "HiddenContent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
