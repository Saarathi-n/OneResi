-- The claim table the registration port has been promising since the seam (D-04).
--
-- A free-text home ("Plot-104, the one near the gate") is held exactly as the applicant wrote
-- it, and the decision is stamped onto the same row rather than replacing it: resolvedUnitId
-- and resolvedAt when the committee approved and the unit was created, decidedById and
-- resolvedAt when they declined. The row is never deleted, which is what makes the audit the
-- applicant's own words plus what became of them.
--
-- userId is UNIQUE because there is at most one live claim per account — the port's findClaim
-- returns the live claim, and a uniqueness constraint is the invariant that keeps that query
-- from lying. It does NOT prevent a resubmission: a new claim for the same account replaces
-- the old row, which the adapter does inside the create transaction.

-- CreateTable
CREATE TABLE "registration_claim" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "blockName" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "note" TEXT,
    "resolvedUnitId" INTEGER,
    "decidedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registration_claim_userId_key" ON "registration_claim"("userId");

-- CreateIndex
CREATE INDEX "registration_claim_resolvedUnitId_idx" ON "registration_claim"("resolvedUnitId");

-- CreateIndex
CREATE INDEX "registration_claim_decidedById_idx" ON "registration_claim"("decidedById");

-- AddForeignKey
ALTER TABLE "registration_claim" ADD CONSTRAINT "registration_claim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_claim" ADD CONSTRAINT "registration_claim_resolvedUnitId_fkey" FOREIGN KEY ("resolvedUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_claim" ADD CONSTRAINT "registration_claim_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
