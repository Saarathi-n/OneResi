-- The slot-holds table, the structural fix for D-81.
--
-- The partial unique index on booking (facilityId, bookingDate, startTime) guards the exact
-- start only. Two windows that overlap but start at different times — 10:00-12:00 and
-- 11:00-13:00 — share no start, so under READ COMMITTED both transactions can read no conflict
-- and both commit: the facility is double-booked for the middle hour.
--
-- One hold row per hour of the facility-date a live booking spans. Any two overlapping ranges
-- share at least one hour of the day, so the unique constraint below refuses the second
-- overlapping insert with no isolation level required to see it. The end of a window is
-- exclusive — 10:00-12:00 holds hours 10 and 11 — so two back-to-back bookings do not collide.
--
-- Holds are written beside the booking in one transaction and deleted when the booking stops
-- holding the slot (cancelled or rejected); a confirmed booking keeps them until it happens.
-- A plain unique constraint exists identically on SQLite and PostgreSQL, which a gist
-- exclusion constraint would not — the parity rule decides the shape.
--
-- See the sqlite twin of this migration for the same change in that dialect; the comment and
-- the intent are byte for byte the same, only the DDL spelling differs.

-- CreateTable
CREATE TABLE "booking_slot_hold" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "facilityId" INTEGER NOT NULL,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "startHour" INTEGER NOT NULL,

    CONSTRAINT "booking_slot_hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_slot_hold_facilityId_bookingDate_startHour_key" ON "booking_slot_hold"("facilityId", "bookingDate", "startHour");

-- CreateIndex
CREATE INDEX "booking_slot_hold_bookingId_idx" ON "booking_slot_hold"("bookingId");

-- AddForeignKey
ALTER TABLE "booking_slot_hold" ADD CONSTRAINT "booking_slot_hold_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
