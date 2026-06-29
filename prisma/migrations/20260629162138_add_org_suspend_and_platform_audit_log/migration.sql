-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "isSuspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorClerkId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetOrgId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAuditLog_targetOrgId_createdAt_idx" ON "PlatformAuditLog"("targetOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_actorClerkId_createdAt_idx" ON "PlatformAuditLog"("actorClerkId", "createdAt");
