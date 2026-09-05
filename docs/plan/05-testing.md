# 05 — Testing

What exists today is a PowerShell script that prints `ALL 29 SPECIFICATION CHECKS PASSED 100%!`
unconditionally, with one real assertion in 118 lines, covering roughly 14 use cases, unable to run
twice, and asserting nothing about email (D-75). No test framework is installed, though the
delivery pipeline in `architecture.md` claims to run `vitest`.

## Stack

| Layer | Tool | Runs against |
|---|---|---|
| Unit | Vitest | pure functions, domain rules, no I/O |
| Integration | Vitest | a real database, **both targets** |
| Contract | Vitest | Zod schemas vs handlers vs client calls |
| End to end | Playwright | both front ends, three browsers, a mobile viewport |
| Mail | Vitest + a live AWS suite | outbox rows locally, SES events on AWS |
| Accessibility | `axe-core` in Playwright | every route, both themes |
| Load | `autocannon` | the gate verification path only |

`pnpm verify` is the single gate: typecheck, lint, the two copy gates from 04, unit, integration on
both targets, contract, a11y. Under two minutes, or people stop running it.

## The parity suite — the important one

Every integration test runs twice: once against SQLite, once against PostgreSQL. Same test bodies,
one fixture factory, target chosen by an environment variable.

```
pnpm test:int              # local target
pnpm test:int:pg           # a throwaway Postgres, container or RDS
pnpm test:parity           # both, and diff the results
```

This is what permanently kills the defect class that produced D-15, D-16, D-25 and D-27. Today the
mock accepts `PLOT` as a unit type, ignores `select`, fakes transactions and returns unfiltered
reads, so mock mode is a different system with different rules — and it is the one that has been
exercised. A test that must pass identically on both engines makes that impossible to reintroduce.

Included specifically:

- The composite unique index on `(unit_id, billing_period)` rejects a second insert (D-17).
- The partial unique index rejects a second live booking for the same slot, **and** permits one
  after the first is cancelled — the case ADR 0003 says the naive constraint breaks (D-18).
- A rolled-back transaction leaves no partial write, asserted by row count (D-25).
- `select`/`omit` actually excludes `password_hash` (D-12).
- The generated SQLite and PostgreSQL schemas differ only in the provider line.

## Domain suite, by use case

One file per use case, named for it, with the identifier in the filename and a comment — never in
the product (04). Each covers the main flow, every alternative flow the description lists, and the
postcondition.

The 28 live use cases; UC-28 is withdrawn by ADR 0002.

Cases the current build gets wrong, which therefore get named tests:

| Test | Asserts |
|---|---|
| UC-07 reopen window | `resolved_at` survives a later non-resolving update, and the 7-day boundary is enforced at both ends (D-20) |
| UC-05 decision audit | `decided_by` and `decided_at` are non-null after any decision (D-21) |
| UC-03 reset | token stored hashed, single use, expires at 15 minutes, invalidates existing sessions (D-22, D-23) |
| UC-14 verification | expired, cancelled and already-used passes are **refused**, and the response is a verdict rather than a row (D-40) |
| UC-15 check-in | idempotent per pass; a second attempt does not create a second log row |
| UC-09 payment | a resident cannot pay another unit's invoice; a repeated confirmation creates no second payment row (D-07) |
| UC-21 billing | a concurrent second run raises no duplicates; the run refuses outright if the period exists |
| UC-12 cancel | releases the slot and the slot is immediately bookable |
| UC-19 approval | rejecting a resident does not leave the unit marked occupied (D-42) |
| UC-18 deactivate | a disabled account loses access on its next request, not in seven days (D-24) |

## Mail suite

You asked for this one by name. Three tiers, because "did the mail work" means three different
things.

### Tier 1 — every message is a row

Mail history moves out of `.dev_emails.json` and into the database (D-31), which makes assertions
possible. The outbox worker records provider, message id, template, recipient, subject, rendered
text and HTML, status, error, attempt count, and a correlation id back to the domain event.

A small matcher over that table:

```ts
await expectMail()
  .to('priya@oneresi.local')
  .withTemplate('invoice.raised')
  .withSubject(/Maintenance for September/)
  .withVars({ amount: '₹4,800.00', dueDate: '15 Sep 2026' })
  .toHaveBeenSentOnce();

await expectMail().toHaveNoUnsent();
```

What gets asserted for every one of the six mail-producing use cases:

- Exactly one message per recipient. No duplicates — posting one notice currently emails every
  resident in the society for every unit's invoice in mock mode (D-29).
- Only the intended recipients: active residents of the affected unit, not pending or disabled
  accounts, not every resident.
- No use-case identifier in the subject (04), enforced here as well as by the copy gate, because
  templates are the place it will creep back.
- Every link absolute and pointing at the configured origin. Six templates currently hardcode
  `http://localhost:3000` (D-22, D-29).
- Both a text and an HTML part; the HTML renders without external CSS; the text part is readable.
- The rendered amount matches the invoice to the paisa.
- **When the provider throws, the calling use case still succeeds** and the outbox row is marked
  failed with the error. That is UC-29 alternative flow 3a, and it is currently a `try`/`catch`
  around an inline send, which is why failures are invisible.

### Tier 2 — the provider is really called

A fake SES transport that records the exact `SendEmailCommand` input, so the region, the source
identity, the configuration set name and the destination are asserted without spending anything.
This is what would have caught the fact that `SESEmailProvider` only writes a console line and
never had an AWS SDK to call (D-30).

### Tier 3 — it left AWS

`pnpm test:mail:live`, opt-in, against the deployed stack. Terraform provisions an SES
configuration set whose events publish to SNS and then SQS (03). The test:

1. Sends to a verified probe address with a unique token in the subject.
2. Polls the SQS queue for up to 60 seconds.
3. Asserts a `SEND` event and then a `DELIVERY` event carrying that token.
4. Asserts no `BOUNCE`, `COMPLAINT` or `REJECT`.
5. Drains the queue so the next run starts clean.

A bounce suite sends to `bounce@simulator.amazonses.com` and `complaint@simulator.amazonses.com`
and asserts the address lands on the suppression list and the outbox row is marked accordingly.
The simulator works in sandbox and costs nothing.

If you buy a domain, an optional fourth tier adds SES inbound receipt rules writing to S3, and the
test reads the delivered message out of the bucket — a genuine round trip. Not needed for a
demonstration.

### Locally

`/dev/mail` in the dev console: every message with its rendered HTML, text, variables and status,
searchable, with a resend button. Dev-only, stripped from production builds — unlike the current
`/api/admin/emails`, which is a production admin screen whose only purpose is showing a development
artifact.

## Database suite

Beyond the parity tests:

- **Migrations** — apply from empty on both targets; every migration is reversible or explicitly
  marked irreversible; no drift between the migration history and the schema
  (`prisma migrate diff --exit-code` in CI).
- **Seed** — running it twice leaves identical row counts and identical checksums. Half of the
  current seed uses `create` and throws on a second run (D-45).
- **Constraints** — one test per unique index and per check constraint, asserting the violation
  rather than the happy path. This is the only kind of test that would have caught the two missing
  indexes.
- **Referential behaviour** — deleting a staff account must **not** cascade away invoices,
  complaint updates or notices; `onDelete: Restrict` asserted per relation (D-47).
- **Indexes** — an `EXPLAIN` assertion that the gate-code lookup and the per-unit list use an index
  scan. Cheap, and it is the requirement with a stated two-second budget.
- **Sync** — seed local, `db:push`, checksum every table, `db:pull` into an empty local, checksum
  again. Round-trip equality is the acceptance test for phase 6.

## State management suite

- **Server state** — every mutation revalidates exactly the affected route and no others. A test
  counts requests: creating one visitor pass currently refetches seven endpoints (D-66).
- **Optimistic updates** — a forced failure reverts the row to its previous value and shows a toast;
  no orphaned pending state survives.
- **Offline queue** — mutate offline, assert the row is queued and visibly so, reconnect, assert it
  replays exactly once. Replayed twice is the interesting failure, so the test forces a duplicate
  delivery and asserts idempotency by request key.
- **Cache invalidation across roles** — an administrator approving a booking is visible to the
  resident on their next load, with no stale read.
- **Session lifecycle** — access token expiry triggers a refresh without the user noticing; a
  revoked refresh token forces a clean sign-out rather than a redirect loop.
- **Form state** — the registration draft survives a reload and a browser restart, and is cleared on
  successful submit (04).

## End-to-end

Playwright, against a seeded database, per browser: Chromium, Firefox, WebKit, plus a 390×844
viewport for the app.

Journeys: register → approve → sign in · issue a pass → verify at the gate → check in → check out ·
walk-in → resident decides → entry recorded · raise a complaint → admin resolves → resident reopens
· generate invoices → resident pays → receipt renders and downloads · book a facility → conflict
refused → admin confirms → resident cancels → the slot rebooks · post a notice → it appears for the
resident and in their mail.

Also, and these are the ones that guard the requirements you care about:

- **No privilege escalation reachable from any unauthenticated page.** Asserts the three
  hardcoded-credential paths are gone (D-01).
- **Every API route rejects an unauthenticated request** — a table-driven test over the route
  manifest, so a new route with no guard fails the suite. Four routes are currently open (D-02,
  D-03).
- **Role isolation** — signed in as the gate account, assert zero complaints, zero invoices, zero
  bookings and zero other-unit pass codes are returned (D-14).
- **No `password_hash` in any response body**, asserted by scanning every response in the run
  (D-12).
- **PWA** — the manifest validates, the service worker registers, the app is installable, and the
  shell loads with the network disabled.
- **Motion** — with `prefers-reduced-motion: reduce`, no transform-based transition runs and every
  state change is still visible.
- **Accessibility** — `axe` on every route in both themes, zero serious or critical violations;
  keyboard-only completion of the three most common tasks; focus is trapped in dialogs and restored
  on close.

## Performance

One target, because the SRS names one: gate verification returns a verdict within two seconds at
the 95th percentile with 20 concurrent guards. Asserted by `autocannon` against the deployed stack,
not by a comment claiming it. The current test script prints "verified code in <2s" without timing
anything.

## What CI runs

Pull request: `pnpm verify`, plus Playwright on Chromium and `terraform plan`.
Merge to main: the full matrix, then deploy, then a smoke journey against the CloudFront URL.
Nightly: the live mail suite and the performance check, only while the stack is up.

