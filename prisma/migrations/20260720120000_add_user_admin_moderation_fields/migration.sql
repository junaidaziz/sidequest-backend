-- Phase 8 (web platform): admin-facing end-user moderation fields on the `users`
-- table. Additive only — no existing column is altered or dropped.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT,
ADD COLUMN     "suspendedByAdminId" TEXT,
ADD COLUMN     "restrictedFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "users_suspendedAt_idx" ON "users"("suspendedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_suspendedByAdminId_fkey" FOREIGN KEY ("suspendedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
