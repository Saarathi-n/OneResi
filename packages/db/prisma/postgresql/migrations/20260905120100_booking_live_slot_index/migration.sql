-- Hand written, and it has to be.
--
-- This is the constraint that actually prevents a double booking. The submitted DDL specifies a
-- plain UNIQUE (Facility_ID, Booking_Date, Slot); docs/data-model.md shows why that is wrong — a
-- cancelled booking would keep occupying its slot forever, so UC-12's "cancelling releases the
-- slot so it becomes bookable again" is impossible to satisfy.
--
-- Restricting the index to the two statuses that actually hold a slot fixes both problems at
-- once: two live bookings cannot share a slot, and a cancelled or rejected one stops blocking it.
--
-- Prisma cannot express a filtered unique index in schema.prisma, which is why this lives in a
-- migration rather than the model. ADR 0003 requires it. The previous build had neither the index
-- nor a migrations directory to put it in, so double booking was reachable through a check-then-
-- insert with nothing serialising the two (D-18).
--
-- SQLite and PostgreSQL support partial indexes with identical syntax, so this file is byte for
-- byte the same on both targets. A test asserts the constraint holds, and that a slot becomes
-- bookable again after a cancellation.

CREATE UNIQUE INDEX "booking_live_slot_key"
    ON "booking" ("facilityId", "bookingDate", "startTime")
    WHERE "status" IN ('PENDING', 'CONFIRMED');
