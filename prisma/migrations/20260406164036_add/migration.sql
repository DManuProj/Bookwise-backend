/*
  Warnings:

  - Added the required column `orgId` to the `StaffLeave` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StaffLeave" ADD COLUMN     "orgId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "StaffLeave" ADD CONSTRAINT "StaffLeave_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
