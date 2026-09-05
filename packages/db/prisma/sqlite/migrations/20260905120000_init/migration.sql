-- CreateTable
CREATE TABLE "block" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "floors" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "unit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "blockId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "monthlyChargePaise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "unit_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "block" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resident_user" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'R',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "passwordChangedAt" DATETIME,
    "resetTokenHash" TEXT,
    "resetExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "resident_user_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "visitor_pass" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "visitorName" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "validOn" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visitor_pass_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "visitor_pass_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "resident_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "visitor_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "passId" INTEGER,
    "unitId" INTEGER NOT NULL,
    "walkInName" TEXT,
    "walkInPhone" TEXT,
    "walkInPurpose" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "decidedById" INTEGER,
    "decidedAt" DATETIME,
    "overrideReason" TEXT,
    "enteredAt" DATETIME,
    "exitedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visitor_log_passId_fkey" FOREIGN KEY ("passId") REFERENCES "visitor_pass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "visitor_log_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "visitor_log_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "resident_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "complaint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "photoKeys" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" DATETIME,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "complaint_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "complaint_update" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "complaintId" INTEGER NOT NULL,
    "updatedById" INTEGER NOT NULL,
    "statusAfter" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "complaint_update_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "complaint_update_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "resident_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "unitId" INTEGER NOT NULL,
    "raisedById" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "dueOn" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "cancelledReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "invoice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoice_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "resident_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "recordedById" INTEGER,
    "amountPaise" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "resident_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "facility" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "opensAt" TEXT NOT NULL,
    "closesAt" TEXT NOT NULL,
    "hourlyRatePaise" INTEGER NOT NULL DEFAULT 0,
    "bookingRules" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "booking" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "facilityId" INTEGER NOT NULL,
    "unitId" INTEGER NOT NULL,
    "decidedById" INTEGER,
    "bookingDate" DATETIME NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" DATETIME,
    "decisionReason" TEXT,
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "booking_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "booking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "booking_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "resident_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "attachmentKey" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "resident_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "correlationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "mail_message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "sentAt" DATETIME,
    "deliveryState" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_message_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "outbox_event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "resident_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "replacesId" INTEGER,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "resident_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rate_limit_window" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "windowStartedAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "receipt_sequence" (
    "period" TEXT NOT NULL PRIMARY KEY,
    "next" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "schema_fingerprint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "digest" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

