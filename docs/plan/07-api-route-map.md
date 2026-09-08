# API route map

The exact surface both front ends build against. `apps/web` hosts every API route under
`apps/web/src/app/api/**` (port 3000). `apps/app` (port 3001, basePath `/a/`) renders its own pages
and calls these routes cross-origin in dev and same-origin in the single-container deploy, where the
app is served from the same origin under `/a/`.

Every row below names the contract that parses the body, the one service call the handler makes, and
who may call it. A handler authenticates, parses with a contract, calls one service, and maps the
result — nothing else (WIRING rule 4). The route table is the contract between the two front-end
streams: neither invents a path.

## Conventions that hold for every route

- **Actor resolution.** `resolveActor(bearerToken)` runs before the handler body. 401 on failure.
  The handler then calls the service with the `Actor`. Deny by default — no role check is inverted.
- **RequestMeta.** `ip` from `x-forwarded-for` (first hop) falling back to the socket address,
  `userAgent` from the request header, `correlationId` from `x-request-id` or generated. Meta rides
  every service call that takes one — it is what the outbox correlates by.
- **Tokens.** Access token: `Authorization: Bearer <jwt>`, held in client memory only (15-minute
  TTL). Refresh token: httpOnly `oneresi_rt` cookie, `SameSite=Lax`, `Path=/api/auth`, 14 days.
  Cross-origin in dev means the app's fetches set `credentials: 'include'`.
- **Error mapping** — one `toResponse` helper, shared shape `{ code, message, field? }`:
  `UNAUTHENTICATED` → 401, `FORBIDDEN` → 403, `NOT_FOUND` → 404, `INVALID_INPUT` → 400,
  `RATE_LIMITED` → 429 + `Retry-After`, and `CONFLICT`, `STATE_NOT_ALLOWED`, `LIMIT_REACHED`,
  `WINDOW_CLOSED`, `ALREADY_DONE` → 409. Success returns the service's view as JSON, dates as ISO
  strings, Paise as the integer (the interface formats).
- **Parsing.** Zod parse failure is a 400 with `{ code: 'INVALID_INPUT', message: 'Check the form
  and try again.' }` and the field paths. A parse failure is not a domain error and never throws.
- **Enums and money leave through the edge.** `C.INVOICE_STATUS[invoice.status].label` in the
  component; `C.formatMoney(invoice.amountPaise)` in the component. Raw values and paise integers
  cross the wire as-is — the label and the rupees happen in React, never in a handler.

## Auth and account

| Method | Path | Contract | Service call | Who |
|---|---|---|---|---|
| POST | `/api/auth/register` | `C.RegisterInput` | `accounts.register(input, meta)` | public |
| POST | `/api/auth/sign-in` | `C.SignInInput` | `accounts.signIn(input, meta)` | public |
| POST | `/api/auth/refresh` | — (refresh cookie) | `accounts.refresh(token, meta)` | cookie holder |
| POST | `/api/auth/sign-out` | — (refresh cookie) | `accounts.signOut(token)` | cookie holder |
| GET | `/api/auth/me` | — | `accounts.me(actor)` | signed in |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `accounts.changePassword` | signed in |
| POST | `/api/auth/password/reset-request` | `C.RequestPasswordResetInput` | `accounts.requestPasswordReset` | public |
| POST | `/api/auth/password/reset-complete` | `C.CompletePasswordResetInput` | `accounts.completePasswordReset` | public |
| GET | `/api/registration/options` | — | `property.registrationOptions()` | public |

Sign-in and refresh set the `oneresi_rt` cookie; sign-out clears it. Register is the one public
write — everyone after the first account queues as PENDING (D-01).

## Registration queue (committee)

| Method | Path | Contract | Service call | Who |
|---|---|---|---|---|
| GET | `/api/applications` | — | `accounts.pendingApplications(actor)` | role A |
| POST | `/api/applications/decision` | `C.DecideRegistrationInput` | `accounts.decideRegistration(actor, input, meta)` | role A |

## Billing

| Method | Path | Contract | Service call | Who |
|---|---|---|---|---|
| GET | `/api/billing/invoices` | — | `billing.forHousehold(actor)` | resident |
| GET | `/api/billing/invoices/society` | — | `billing.forSociety(actor)` | role A |
| POST | `/api/billing/invoices` | `C.RaiseInvoicesInput` | `billing.raiseForPeriod(actor, input)` | role A |
| POST | `/api/billing/invoices/[id]/pay` | `C.PayInvoiceInput` | `billing.pay(actor, input)` | resident |
| POST | `/api/billing/invoices/[id]/offline-payment` | `C.RecordOfflinePaymentInput` | `billing.recordOffline(actor, input)` | role A |
| POST | `/api/billing/invoices/[id]/cancel` | `C.CancelInvoiceInput` | `billing.cancel(actor, input)` | role A |
| GET | `/api/billing/receipts/[receiptNo]` | — | `billing.receipt(actor, receiptNo)` | resident own / role A |

The receipt also renders as its own server route, `/receipts/[receiptNo]` on web (see
04-product-design.md): the handler resolves the actor, calls `billing.receipt`, and the page prints.
`flagOverdue` takes a `SystemActor` — it belongs to the scheduled job in `infra/`, never a route.

## Visitors and the gate

| Method | Path | Contract | Service call | who |
|---|---|---|---|---|
| GET | `/api/visitors/passes` | — | `visitors.passesForHousehold(actor)` | resident |
| POST | `/api/visitors/passes` | `C.CreatePassInput` | `visitors.issuePass(actor, input)` | resident |
| POST | `/api/visitors/passes/[id]/cancel` | — | `visitors.cancelPass(actor, id)` | resident |
| GET | `/api/visitors/expected-today` | — | `visitors.expectedToday(actor)` | resident |
| GET | `/api/visitors/waiting` | — | `visitors.waitingForHousehold(actor)` | resident |
| POST | `/api/visitors/walk-ins/[id]/decision` | `C.DecideWalkInInput` | `visitors.decideWalkIn(actor, input)` | resident |
| GET | `/api/visitors/entries` | — | `visitors.entriesForHousehold(actor)` | resident |
| POST | `/api/gate/verify` | `C.VerifyPassInput` | `visitors.verifyCode(actor, input, meta)` | role S |
| POST | `/api/gate/entry` | `C.RecordEntryInput` | `visitors.recordEntry(actor, input)` | role S |
| POST | `/api/gate/walk-ins` | `C.LogWalkInInput` | `visitors.logWalkIn(actor, input)` | role S |
| GET | `/api/gate/live` (SSE) | — | polls `visitors.waitingForHousehold` | resident, EventSource |

The gate routes live under their own prefix so the kiosk's surface is auditable as a unit — the
kiosk screen renders a decision, never a row (D-40). The SSE stream is thin: an interval re-calling
`waitingForHousehold` and emitting on change, with a comment heartbeat. It is a wrapper over an
existing service, not a new use case.

## Complaints

| Method | Path | Contract | Service call | Who |
|---|---|---|---|---|
| GET | `/api/complaints` | — | `complaints.forHousehold(actor)` | resident |
| GET | `/api/complaints/society` | query `status` (optional) | `complaints.forSociety(actor, filter)` | role A |
| POST | `/api/complaints` | `C.RaiseComplaintInput` | `complaints.raise(actor, input)` | resident |
| POST | `/api/complaints/[id]/updates` | `C.UpdateComplaintInput` | `complaints.update(actor, input)` | role A |
| POST | `/api/complaints/[id]/reopen` | `C.ReopenComplaintInput` | `complaints.reopen(actor, input)` | resident, window |

## Facilities

| Method | Path | Contract | Service call | Who |
|---|---|---|---|---|
| GET | `/api/facilities` | — | `facilities.list(actor)` | signed in |
| GET | `/api/facilities/[id]/availability` | query `on` | `facilities.availability(actor, { facilityId, on })` | signed in |
| POST | `/api/facilities/bookings` | `C.RequestBookingInput` | `facilities.request(actor, input)` | resident |
| GET | `/api/facilities/bookings` | — | `facilities.forHousehold(actor)` | resident |
| GET | `/api/facilities/bookings/society` | — | `facilities.bookingsForSociety(actor)` | role A |
| POST | `/api/facilities/bookings/[id]/cancel` | `C.CancelBookingInput` | `facilities.cancel(actor, input)` | resident |
| POST | `/api/facilities/bookings/[id]/decision` | `C.DecideBookingInput` | `facilities.decide(actor, input)` | role A |

## Notices and notifications

| Method | Path | Contract | Service call | Who |
|---|---|---|---|---|
| GET | `/api/notices` | — | `notices.feed(actor)` | signed in |
| POST | `/api/notices` | `C.PublishAnnouncementInput` | `notices.publish(actor, input)` | role A |
| DELETE | `/api/notices/[id]` | — | `notices.withdraw(actor, id)` | role A |
| GET | `/api/notifications` | — | `notifications.unread(actor)` | signed in |
| POST | `/api/notifications/read` | body `{ ids: number[] }` | `notifications.markRead(actor, ids)` | signed in |

## Property (committee)

| Method | Path | Contract | Service call | Who |
|---|---|---|---|---|
| GET | `/api/property/blocks` | — | `property.blocks(actor)` | role A |
| POST | `/api/property/blocks` | `C.CreateBlockInput` | `property.createBlock(actor, input)` | role A |
| POST | `/api/property/units` | `C.CreateUnitInput` | `property.createUnit(actor, input)` | role A |
| PATCH | `/api/property/units/[id]` | `C.UpdateUnitInput` | `property.updateUnit(actor, input)` | role A |

## What is deliberately absent

- No `PUT /api/users/[id]/role`. Role changes are not an endpoint; the committee desk is a role,
  not a form field (D-42's lesson).
- No admin-facing user list beyond the PENDING queue. Everyone else's status is not the desk's
  screen.
- No webhook, no SSE besides the waiting-visitor stream, no push subscription (deferred —
  see the task list).
