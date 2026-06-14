/*
  Warnings:
  - The values [RESCHEDULED] on the enum `BookingStatus` will be removed. If these variants are still used in the database, this will fail.
*/
-- AlterEnum
BEGIN;
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS booking_no_staff_overlap;
CREATE TYPE "BookingStatus_new" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
ALTER TABLE "public"."Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "public"."BookingStatus_old";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_staff_overlap
  EXCLUDE USING gist (
    "userId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE (
    status NOT IN ('CANCELLED', 'NO_SHOW')
    AND "userId" IS NOT NULL
  );
COMMIT;