-- CreateEnum
CREATE TYPE "TaskVerificationMethod" AS ENUM ('NONE', 'SELF', 'CREATOR_APPROVAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "UserTaskStatus" AS ENUM ('Open', 'Invited', 'Accepted', 'Declined', 'Submitted', 'Approved', 'Rejected', 'Cancelled');

-- CreateEnum
CREATE TYPE "TaskSubmissionStatus" AS ENUM ('Submitted', 'Approved', 'Rejected');

-- CreateTable
CREATE TABLE "UserTask" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rewardXp" INTEGER,
    "verificationMethod" "TaskVerificationMethod" NOT NULL DEFAULT 'NONE',
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserTaskStatus" NOT NULL DEFAULT 'Open',
    "inviteToken" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTaskSubmission" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "notes" TEXT,
    "status" "TaskSubmissionStatus" NOT NULL DEFAULT 'Submitted',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "UserTaskSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTaskAttachment" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserTask_inviteToken_key" ON "UserTask"("inviteToken");

-- CreateIndex
CREATE INDEX "UserTask_creatorId_idx" ON "UserTask"("creatorId");

-- CreateIndex
CREATE INDEX "UserTask_assigneeId_idx" ON "UserTask"("assigneeId");

-- CreateIndex
CREATE INDEX "UserTask_status_idx" ON "UserTask"("status");

-- CreateIndex
CREATE INDEX "UserTaskSubmission_taskId_idx" ON "UserTaskSubmission"("taskId");

-- CreateIndex
CREATE INDEX "UserTaskSubmission_submittedById_idx" ON "UserTaskSubmission"("submittedById");

-- CreateIndex
CREATE INDEX "UserTaskAttachment_submissionId_idx" ON "UserTaskAttachment"("submissionId");

-- CreateIndex
CREATE INDEX "UserTaskEvent_taskId_idx" ON "UserTaskEvent"("taskId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_userId_idx" ON "IdempotencyKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_endpoint_key" ON "IdempotencyKey"("userId", "key", "endpoint");

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTaskSubmission" ADD CONSTRAINT "UserTaskSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "UserTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTaskSubmission" ADD CONSTRAINT "UserTaskSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTaskSubmission" ADD CONSTRAINT "UserTaskSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTaskAttachment" ADD CONSTRAINT "UserTaskAttachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "UserTaskSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTaskEvent" ADD CONSTRAINT "UserTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "UserTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTaskEvent" ADD CONSTRAINT "UserTaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

