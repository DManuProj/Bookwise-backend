/*
  Warnings:

  - Added the required column `businessType` to the `Organisation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "businessType" TEXT NOT NULL;
