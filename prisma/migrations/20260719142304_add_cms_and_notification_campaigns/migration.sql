-- CreateEnum
CREATE TYPE "CmsContentStatus" AS ENUM ('Draft', 'Published', 'Archived');

-- CreateEnum
CREATE TYPE "CmsAnnouncementKind" AS ENUM ('Blog', 'Announcement', 'SafetyNotice');

-- CreateEnum
CREATE TYPE "CmsSectionType" AS ENUM ('Hero', 'Feature', 'HowItWorks', 'Stats', 'Testimonials', 'Faq', 'Cta', 'Custom');

-- CreateEnum
CREATE TYPE "CmsLinkPlacement" AS ENUM ('Nav', 'Footer', 'Social', 'Legal');

-- CreateEnum
CREATE TYPE "NotificationCampaignStatus" AS ENUM ('Draft', 'Scheduled', 'Sending', 'Sent', 'Cancelled', 'Failed');

-- CreateEnum
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('Pending', 'Sent', 'Failed', 'Skipped');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'campaign_broadcast';

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "marketingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CmsPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'Draft',
    "publishedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsSection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "CmsSectionType" NOT NULL,
    "title" TEXT,
    "data" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'Draft',
    "publishedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CmsSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsFaq" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'Draft',
    "publishedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CmsFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsTestimonial" (
    "id" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorTitle" TEXT,
    "quote" TEXT NOT NULL,
    "avatarKey" TEXT,
    "rating" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'Draft',
    "publishedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CmsTestimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsScreenshot" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "imageKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'Draft',
    "publishedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CmsScreenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsAnnouncement" (
    "id" TEXT NOT NULL,
    "kind" "CmsAnnouncementKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" JSONB NOT NULL,
    "coverImageKey" TEXT,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'Draft',
    "publishedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CmsAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsLink" (
    "id" TEXT NOT NULL,
    "placement" "CmsLinkPlacement" NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "openInNewTab" BOOLEAN NOT NULL DEFAULT false,
    "status" "CmsContentStatus" NOT NULL DEFAULT 'Draft',
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CmsLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "targetFilter" JSONB,
    "status" "NotificationCampaignStatus" NOT NULL DEFAULT 'Draft',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'Pending',
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_slug_key" ON "CmsPage"("slug");

-- CreateIndex
CREATE INDEX "CmsPage_status_idx" ON "CmsPage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CmsSection_key_key" ON "CmsSection"("key");

-- CreateIndex
CREATE INDEX "CmsSection_type_idx" ON "CmsSection"("type");

-- CreateIndex
CREATE INDEX "CmsSection_status_idx" ON "CmsSection"("status");

-- CreateIndex
CREATE INDEX "CmsFaq_status_idx" ON "CmsFaq"("status");

-- CreateIndex
CREATE INDEX "CmsTestimonial_status_idx" ON "CmsTestimonial"("status");

-- CreateIndex
CREATE INDEX "CmsScreenshot_status_idx" ON "CmsScreenshot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CmsAnnouncement_slug_key" ON "CmsAnnouncement"("slug");

-- CreateIndex
CREATE INDEX "CmsAnnouncement_kind_idx" ON "CmsAnnouncement"("kind");

-- CreateIndex
CREATE INDEX "CmsAnnouncement_status_idx" ON "CmsAnnouncement"("status");

-- CreateIndex
CREATE INDEX "CmsAnnouncement_publishedAt_idx" ON "CmsAnnouncement"("publishedAt");

-- CreateIndex
CREATE INDEX "CmsLink_placement_idx" ON "CmsLink"("placement");

-- CreateIndex
CREATE INDEX "CmsLink_status_idx" ON "CmsLink"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_key_key" ON "AppConfig"("key");

-- CreateIndex
CREATE INDEX "NotificationCampaign_status_idx" ON "NotificationCampaign"("status");

-- CreateIndex
CREATE INDEX "NotificationCampaign_scheduledAt_idx" ON "NotificationCampaign"("scheduledAt");

-- CreateIndex
CREATE INDEX "NotificationCampaignRecipient_campaignId_idx" ON "NotificationCampaignRecipient"("campaignId");

-- CreateIndex
CREATE INDEX "NotificationCampaignRecipient_userId_idx" ON "NotificationCampaignRecipient"("userId");

-- CreateIndex
CREATE INDEX "NotificationCampaignRecipient_status_idx" ON "NotificationCampaignRecipient"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCampaignRecipient_campaignId_userId_key" ON "NotificationCampaignRecipient"("campaignId", "userId");

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsSection" ADD CONSTRAINT "CmsSection_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsSection" ADD CONSTRAINT "CmsSection_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsFaq" ADD CONSTRAINT "CmsFaq_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsFaq" ADD CONSTRAINT "CmsFaq_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsTestimonial" ADD CONSTRAINT "CmsTestimonial_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsTestimonial" ADD CONSTRAINT "CmsTestimonial_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsScreenshot" ADD CONSTRAINT "CmsScreenshot_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsScreenshot" ADD CONSTRAINT "CmsScreenshot_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsAnnouncement" ADD CONSTRAINT "CmsAnnouncement_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsAnnouncement" ADD CONSTRAINT "CmsAnnouncement_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsLink" ADD CONSTRAINT "CmsLink_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsLink" ADD CONSTRAINT "CmsLink_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppConfig" ADD CONSTRAINT "AppConfig_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppConfig" ADD CONSTRAINT "AppConfig_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaignRecipient" ADD CONSTRAINT "NotificationCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaignRecipient" ADD CONSTRAINT "NotificationCampaignRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
