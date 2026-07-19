-- AlterTable
ALTER TABLE "NotificationCampaign" ADD COLUMN     "updatedByAdminId" TEXT;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaignRecipient" ADD CONSTRAINT "NotificationCampaignRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
