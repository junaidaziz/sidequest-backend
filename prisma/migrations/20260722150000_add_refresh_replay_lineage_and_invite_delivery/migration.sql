ALTER TABLE "users" ADD COLUMN "refreshPreviousTokenHash" TEXT;
ALTER TABLE "AdminSession" ADD COLUMN "refreshPreviousTokenHash" TEXT;

ALTER TABLE "AdminUser"
  ADD COLUMN "inviteDeliveryStatus" TEXT,
  ADD COLUMN "inviteDeliveryAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "inviteDeliveryError" TEXT;
