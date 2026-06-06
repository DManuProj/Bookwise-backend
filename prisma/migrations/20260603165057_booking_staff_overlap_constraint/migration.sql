CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
ADD CONSTRAINT booking_no_staff_overlap
EXCLUDE USING gist (
  "userId" WITH =,
  tsrange("startAt", "endAt", '[)') WITH &&
)
WHERE (
  status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
  AND "userId" IS NOT NULL
);
