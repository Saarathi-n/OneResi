-- CreateTable
CREATE TABLE "block" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "floors" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" SERIAL NOT NULL,
    "blockId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "monthlyChargePaise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resident_user" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'R',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "passwordChangedAt" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resident_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_pass" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "visitorName" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "validOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_log" (
    "id" SERIAL NOT NULL,
    "passId" INTEGER,
    "unitId" INTEGER NOT NULL,
    "walkInName" TEXT,
    "walkInPhone" TEXT,
    "walkInPurpose" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "enteredAt" TIMESTAMP(3),
    "exitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "photoKeys" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_update" (
    "id" SERIAL NOT NULL,
    "complaintId" INTEGER NOT NULL,
    "updatedById" INTEGER NOT NULL,
    "statusAfter" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" SERIAL NOT NULL,
    "unitId" INTEGER NOT NULL,
    "raisedById" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "recordedById" INTEGER,
    "amountPaise" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "opensAt" TEXT NOT NULL,
    "closesAt" TEXT NOT NULL,
    "hourlyRatePaise" INTEGER NOT NULL DEFAULT 0,
    "bookingRules" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" SERIAL NOT NULL,
    "facilityId" INTEGER NOT NULL,
    "unitId" INTEGER NOT NULL,
    "decidedById" INTEGER,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "attachmentKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_message" (
    "id" SERIAL NOT NULL,
    "outboxEventId" INTEGER,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "template" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "variables" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveryState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacesId" INTEGER,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_window" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rate_limit_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_sequence" (
    "period" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "receipt_sequence_pkey" PRIMARY KEY ("period")
);

-- CreateTable
CREATE TABLE "schema_fingerprint" (
    "id" SERIAL NOT NULL,
    "digest" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_fingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "block_name_key" ON "block"("name");

-- CreateIndex
CREATE INDEX "unit_blockId_idx" ON "unit"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_blockId_label_key" ON "unit"("blockId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "resident_user_email_key" ON "resident_user"("email");

-- CreateIndex
CREATE INDEX "resident_user_unitId_idx" ON "resident_user"("unitId");

-- CreateIndex
CREATE INDEX "resident_user_status_role_idx" ON "resident_user"("status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "visitor_pass_code_key" ON "visitor_pass"("code");

-- CreateIndex
CREATE INDEX "visitor_pass_unitId_idx" ON "visitor_pass"("unitId");

-- CreateIndex
CREATE INDEX "visitor_pass_createdById_idx" ON "visitor_pass"("createdById");

-- CreateIndex
CREATE INDEX "visitor_pass_validOn_status_idx" ON "visitor_pass"("validOn", "status");

-- CreateIndex
CREATE INDEX "visitor_log_unitId_createdAt_idx" ON "visitor_log"("unitId", "createdAt");

-- CreateIndex
CREATE INDEX "visitor_log_passId_idx" ON "visitor_log"("passId");

-- CreateIndex
CREATE INDEX "visitor_log_approvalStatus_idx" ON "visitor_log"("approvalStatus");

-- CreateIndex
CREATE INDEX "complaint_unitId_createdAt_idx" ON "complaint"("unitId", "createdAt");

-- CreateIndex
CREATE INDEX "complaint_status_priority_idx" ON "complaint"("status", "priority");

-- CreateIndex
CREATE INDEX "complaint_update_complaintId_createdAt_idx" ON "complaint_update"("complaintId", "createdAt");

-- CreateIndex
CREATE INDEX "complaint_update_updatedById_idx" ON "complaint_update"("updatedById");

-- CreateIndex
CREATE INDEX "invoice_unitId_idx" ON "invoice"("unitId");

-- CreateIndex
CREATE INDEX "invoice_raisedById_idx" ON "invoice"("raisedById");

-- CreateIndex
CREATE INDEX "invoice_status_dueOn_idx" ON "invoice"("status", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_unitId_period_key" ON "invoice"("unitId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receiptNo_key" ON "payment"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reference_key" ON "payment"("reference");

-- CreateIndex
CREATE INDEX "payment_invoiceId_idx" ON "payment"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_paidAt_idx" ON "payment"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "facility_name_key" ON "facility"("name");

-- CreateIndex
CREATE INDEX "booking_facilityId_bookingDate_idx" ON "booking"("facilityId", "bookingDate");

-- CreateIndex
CREATE INDEX "booking_unitId_idx" ON "booking"("unitId");

-- CreateIndex
CREATE INDEX "booking_status_idx" ON "booking"("status");

-- CreateIndex
CREATE INDEX "announcement_authorId_idx" ON "announcement"("authorId");

-- CreateIndex
CREATE INDEX "announcement_pinned_createdAt_idx" ON "announcement"("pinned", "createdAt");

-- CreateIndex
CREATE INDEX "announcement_expiresAt_idx" ON "announcement"("expiresAt");

-- CreateIndex
CREATE INDEX "outbox_event_status_availableAt_idx" ON "outbox_event"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_event_type_idx" ON "outbox_event"("type");

-- CreateIndex
CREATE UNIQUE INDEX "mail_message_outboxEventId_key" ON "mail_message"("outboxEventId");

-- CreateIndex
CREATE INDEX "mail_message_toAddress_createdAt_idx" ON "mail_message"("toAddress", "createdAt");

-- CreateIndex
CREATE INDEX "mail_message_template_idx" ON "mail_message"("template");

-- CreateIndex
CREATE INDEX "mail_message_status_idx" ON "mail_message"("status");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_createdAt_idx" ON "notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_tokenHash_key" ON "refresh_token"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_token_userId_expiresAt_idx" ON "refresh_token"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "rate_limit_window_windowStartedAt_idx" ON "rate_limit_window"("windowStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_window_key_windowStartedAt_key" ON "rate_limit_window"("key", "windowStartedAt");

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_user" ADD CONSTRAINT "resident_user_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_log" ADD CONSTRAINT "visitor_log_passId_fkey" FOREIGN KEY ("passId") REFERENCES "visitor_pass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_log" ADD CONSTRAINT "visitor_log_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_log" ADD CONSTRAINT "visitor_log_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_update" ADD CONSTRAINT "complaint_update_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_update" ADD CONSTRAINT "complaint_update_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "resident_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "outbox_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "resident_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "resident_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

