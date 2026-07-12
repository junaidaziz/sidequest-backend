-- CreateEnum
CREATE TYPE "MissionCategory" AS ENUM ('explore', 'create', 'discover');

-- CreateEnum
CREATE TYPE "MissionDifficulty" AS ENUM ('Easy', 'Medium', 'Hard');

-- CreateTable
CREATE TABLE "missions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "MissionCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "fullBrief" TEXT NOT NULL,
    "proofRequirement" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL,
    "difficulty" "MissionDifficulty" NOT NULL,
    "difficultyDots" INTEGER NOT NULL,
    "crewTags" TEXT[],
    "settingTags" TEXT[],
    "costTier" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);
