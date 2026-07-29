-- CreateEnum
CREATE TYPE "MissionTagType" AS ENUM ('Crew', 'Setting');

-- CreateEnum
CREATE TYPE "ContactSubmissionStatus" AS ENUM ('New', 'Read', 'Resolved');

-- AlterTable
ALTER TABLE "MediaVariant" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "MissionTag" (
    "id" TEXT NOT NULL,
    "type" "MissionTagType" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSubmission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ContactSubmissionStatus" NOT NULL DEFAULT 'New',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionTag_type_idx" ON "MissionTag"("type");

-- CreateIndex
CREATE INDEX "MissionTag_isActive_idx" ON "MissionTag"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MissionTag_type_value_key" ON "MissionTag"("type", "value");

-- CreateIndex
CREATE INDEX "ContactSubmission_status_idx" ON "ContactSubmission"("status");

-- CreateIndex
CREATE INDEX "ContactSubmission_createdAt_idx" ON "ContactSubmission"("createdAt");
