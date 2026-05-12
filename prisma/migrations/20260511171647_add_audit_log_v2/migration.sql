/*
  Warnings:

  - The `metadata` column on the `AuditLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `action` on the `AuditLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_COMPLETED', 'BOOKING_UPDATED', 'CUSTOMER_CREATED', 'STAFF_INVITED', 'STAFF_JOINED', 'SERVICE_CREATED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorName" TEXT,
DROP COLUMN "action",
ADD COLUMN     "action" "AuditAction" NOT NULL,
DROP COLUMN "metadata",
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");
