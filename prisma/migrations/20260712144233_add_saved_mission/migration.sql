-- CreateTable
CREATE TABLE "saved_missions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_missions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_missions_userId_idx" ON "saved_missions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_missions_userId_missionId_key" ON "saved_missions"("userId", "missionId");

-- AddForeignKey
ALTER TABLE "saved_missions" ADD CONSTRAINT "saved_missions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_missions" ADD CONSTRAINT "saved_missions_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "missions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
