-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('AVATAR', 'PROOF', 'TASK_ATTACHMENT');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "UserTaskAttachment" ADD COLUMN     "mediaAssetId" TEXT;

-- AlterTable
ALTER TABLE "completions" ADD COLUMN     "proofMediaId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarMediaId" TEXT;

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "relatedEntityId" TEXT,
    "originalKey" TEXT NOT NULL,
    "originalWidth" INTEGER,
    "originalHeight" INTEGER,
    "originalFormat" TEXT,
    "originalSize" INTEGER,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaVariant" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_ownerId_idx" ON "MediaAsset"("ownerId");

-- CreateIndex
CREATE INDEX "MediaAsset_purpose_relatedEntityId_idx" ON "MediaAsset"("purpose", "relatedEntityId");

-- CreateIndex
CREATE INDEX "MediaAsset_status_idx" ON "MediaAsset"("status");

-- CreateIndex
CREATE INDEX "MediaVariant_mediaAssetId_idx" ON "MediaVariant"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaVariant_mediaAssetId_name_key" ON "MediaVariant"("mediaAssetId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserTaskAttachment_mediaAssetId_key" ON "UserTaskAttachment"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "completions_proofMediaId_key" ON "completions"("proofMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "users_avatarMediaId_key" ON "users"("avatarMediaId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completions" ADD CONSTRAINT "completions_proofMediaId_fkey" FOREIGN KEY ("proofMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTaskAttachment" ADD CONSTRAINT "UserTaskAttachment_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaVariant" ADD CONSTRAINT "MediaVariant_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

