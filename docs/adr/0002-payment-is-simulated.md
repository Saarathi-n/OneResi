# ADR 0002 — Payment is simulated, with no gateway integration

**Status** Accepted · 2026-09-02

## Context

The SRS, UC-09, UC-28 and both the architecture and technology stack slides name Razorpay in test
mode as the payment gateway, and SRS 2.5 already commits to test mode only with no real money
moving.

Razorpay onboarding requires business KYC before the dashboard is usable — PAN, Aadhaar, a bank
account in the business's name and a business type declaration. A student project has no
registered entity and cannot furnish these. The same wall exists at Cashfree, PhonePe and Paytm,
and Stripe requires a registered Indian entity as well. There is no gateway that avoids it.

## Decision

Remove the payment gateway entirely. No Razorpay, no external provider, no webhook, no signature
verification. Payment becomes an in-process simulated step: the resident opens an unpaid invoice,
confirms payment on a mock screen with success and failure paths, and on success the application
writes a `PAYMENT` row and moves the invoice to `PAID` inside a single database transaction,
generating a receipt number.

The `Payment Gateway` actor is dropped from the use case diagram, and UC-28 "Verify Payment
Webhook" is withdrawn along with it. UC-09's steps 2 to 4 collapse into the simulated
confirmation.

## What is preserved

The invariant that mattered. SRS 5.4 requires that billing records are never double-counted, and
the submitted schema already enforces it without any gateway: `UQ_PAYMENT_ORDER` is unique, so a
repeated confirmation cannot create a second payment row, and the service additionally requires
the invoice to still be `UNPAID` inside the transaction. `Gateway_Order_ID` is retained as a
generated simulated reference, so no schema change is needed.

The offline path is also legitimate and needs nothing external: `PAYMENT.Method` already permits
`CASH`, so an Admin recording a payment received outside the system is supported as specified.

## Consequences

- UC-28 and one actor disappear from a submitted diagram. This needs a paragraph of explanation
  in the final report, not a silent omission.
- The external services box in the architecture slide shrinks from three entries to two, SES and
  S3, both AWS.
- Nothing about invoices, dues, receipts, reporting or the `INVOICE` and `PAYMENT` schema changes.
- No public webhook endpoint is required, which removes the need for a tunnel during local
  development.
- If a real gateway ever becomes available, it attaches at the same service boundary the simulated
  confirmation already occupies.
