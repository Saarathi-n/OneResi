-- The subscription table the push seam has been promised. One row per browser, keyed by the
-- push service's own endpoint URL for that device — the only identifier both sides agree on.
--
-- A subscription is retired, never deleted: unsubscribedAt is stamped when the person asks or
-- the push service answers 404/410, and resubscribing is an upsert that clears the stamp. The
-- upsert re-claims the row for the caller (userId, p256dh and auth are all updated), because a
-- browser's subscription outlives its sign-in and must follow the account that last asked for
-- it — a device handed from one resident to another must not keep notifying the first.
--
-- The (userId, unsubscribedAt) index is the dispatch read: one person's active subscriptions,
-- which is every device they subscribed on (D-29's per-person rule, the push way).
--
-- See the sqlite twin of this migration for the same change in that dialect; the comment and
-- the intent are byte for byte the same, only the DDL spelling differs.

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "subscribedAt" TIMESTAMP(3) NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_userId_unsubscribedAt_idx" ON "push_subscription"("userId", "unsubscribedAt");

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "resident_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
