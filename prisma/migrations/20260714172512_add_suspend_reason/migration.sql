-- CreateEnum
CREATE TYPE "SuspendReason" AS ENUM ('ADMIN', 'NON_PAYMENT');

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "suspendedReason" "SuspendReason";
