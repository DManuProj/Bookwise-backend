-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "voiceCallId" TEXT;

-- CreateTable
CREATE TABLE "VoiceUsage" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "VoiceUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceUsage_callId_key" ON "VoiceUsage"("callId");

-- CreateIndex
CREATE INDEX "VoiceUsage_orgId_createdAt_idx" ON "VoiceUsage"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "VoiceUsage" ADD CONSTRAINT "VoiceUsage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
