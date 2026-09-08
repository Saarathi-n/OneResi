-- The columns the store ports reach for that the schema dropped — the same shape of defect as
-- D-20 and D-21: the domain asks for a stamp, the schema has nowhere to put it, and the adapter
-- was left discarding it.
--
--   registration_claim.decisionReason — the committee's own words for their decision. Stamped on
--     the claim it belongs to; a claimless decision's reason already travels in the mail row's
--     variables, written in the same transaction.
--   visitor_pass.cancelledAt — the status says a pass died, this says when. cancelPass has been
--     passing the timestamp since the port was written.
--   visitor_log.idempotencyKey — the gate scanner's retry key. Unique, so a retried scan finds
--     the row its first attempt wrote instead of reading a used pass as an error (D-40).
--   resident_user.resetTokenHash — unique index. One token resolves to one account, and the
--     pre-flight lookup becomes a seek instead of a scan. Nullable: multiple NULLs are fine in
--     both dialects, so accounts without a pending reset are unaffected.
--
-- See the sqlite twin of this migration for the same change in that dialect; the comment and the
-- intent are byte for byte the same, only the DDL spelling differs.

-- AlterTable
ALTER TABLE "registration_claim" ADD COLUMN "decisionReason" TEXT;

-- AlterTable
ALTER TABLE "visitor_pass" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "visitor_log" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "visitor_log_idempotencyKey_key" ON "visitor_log"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "resident_user_resetTokenHash_key" ON "resident_user"("resetTokenHash");
