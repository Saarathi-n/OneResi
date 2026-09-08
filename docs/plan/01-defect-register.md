# 01 — Defect Register

Every architectural mistake found in `C:\Developer\Code\OneResi`, with evidence. Paths are
relative to that directory. 80 entries in four severities.

- **S1** — the deployment does not work, or security/money is broken outright. 18 entries.
- **S2** — wrong behaviour, data loss, or a documented requirement that was never built. 32 entries.
- **S3** — the product reads as coursework rather than software. 25 entries.
- **S4** — process and environment. 5 entries.

The three that explain most of the rest, if you only read a few:

- **D-06** — mock mode is the default, so an AWS deployment would ignore the database it provisions.
- **D-15** — the mock store and the Prisma schema are two hand-written implementations of one
  interface, and they already disagree. Every "works locally, breaks on real Postgres" defect
  below descends from this.
- **D-51** — use-case identifiers are printed in the interface and in outbound email. This is
  the single biggest reason the app reads as a mock.

## S1 — Critical

### D-01 · Anyone becomes Admin from the public home page
`src/app/page.tsx:33,149`, `src/app/(auth)/login/page.tsx:67`, `src/app/(auth)/register/page.tsx:103`

Three separate copies of a client-side call that posts `admin@oneresi.local` with the literal
password `Password@123`. On the home page it is a card labelled "Admin Control Desk". On the
login page it appears as "Switch to Admin Desk to Review & Approve Now" when a pending user
fails to sign in. On the registration success screen it is the primary button.

This is not a demo shortcut with a flag around it. It is an unauthenticated privilege
escalation on the landing page of a deployed application, and the password is in the client
bundle.

**Fix** — delete all three. Seeded accounts get real passwords generated at seed time and
printed to the seeding console only. Development convenience moves behind a dev-only route
that is stripped from production builds.

### D-02 · `/api/units` is unauthenticated and returns the resident directory
`src/app/api/units/route.ts:7-32`

`getSessionUser` is imported and never called in `GET`. The handler returns every unit with
its `monthly_charge`, and for each unit every resident's `name`, `email`, `phone` and
`status`. One unauthenticated request returns the contact details of the whole society.

**Fix** — authenticate, then scope. Registration needs a much narrower public endpoint that
returns block and unit labels only, no charges, no occupants.

### D-03 · Three more unauthenticated read endpoints
`src/app/api/blocks/route.ts:7`, `api/facilities/route.ts:7`, `api/notices/route.ts:9`

Blocks returns every block with its units. Notices returns every announcement including
maintenance windows and AGM schedules, plus publisher names. Facilities returns the amenity
list and pricing.

**Fix** — all four move behind the session. The public surface is the marketing site and a
minimal registration lookup, nothing else.

### D-04 · Registration creates blocks and units, and the applicant sets their own bill
`src/app/api/auth/register/route.ts:46-105`, `src/app/(auth)/register/page.tsx:301-311`

The public registration endpoint accepts `isNewUnit`, `newBlockName`, `newUnitNo`,
`newUnitType` and `monthlyCharge`. It creates `Block` rows and `Unit` rows on demand. The
registration form renders `monthlyCharge` as a number input defaulting to 2500.

`unit.monthly_charge` is what the billing run snapshots into every invoice. So an applicant
chooses their own maintenance charge, before any approval, from a page with no authentication.
Blocks and units are administrator-owned entities per UC-18.

**Fix** — registration selects an existing unit or submits a free-text claim ("Plot-104,
Phase 3") that an administrator resolves during approval. Charges are set only by an
administrator. Block and unit creation moves to the authenticated admin API.

### D-05 · `JWT_SECRET` falls back to a hardcoded literal, and AWS never sets it
`src/lib/auth.ts:6-8`, `infra/compute.tf:81-98`

```ts
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-minimum-32-chars-key-for-jwt-signing'
);
```

The task definition sets `DATABASE_URL`, `STORAGE_DRIVER`, `EVENT_DRIVER` and `NODE_ENV`. It
does not set `JWT_SECRET`. A deployed container therefore signs sessions with a constant that
is committed to the repository, so anyone can mint an admin token.

**Fix** — no fallback. Fail to boot if the secret is absent or under 32 bytes. Generate it in
Terraform, store it as an SSM `SecureString`, inject via the task definition's `secrets` block
so it never appears in plaintext.

### D-06 · Mock mode is the default, so the AWS deployment ignores RDS
`src/lib/db.ts:9`, `infra/compute.tf:81-98`

```ts
const useMock = process.env.USE_MOCK_DB !== 'false';
```

Mock is chosen unless the variable is exactly the string `'false'`. The task definition never
sets it. Terraform provisions a PostgreSQL instance, wires its connection string into the
container, and the container then writes to an in-memory JSON store that resets on every task
restart and is not shared between tasks.

This is the most consequential line in the codebase. Everything about the cloud architecture
is undone by one default.

**Fix** — invert it. Real database is the default; the offline adapter is opt-in and refuses
to load when `NODE_ENV=production`.

### D-07 · Any resident can settle any invoice
`src/app/api/payment/simulate/route.ts:30-63`

The handler checks that a session exists and nothing else. It loads the invoice by the
client-supplied `invoiceId` and marks it `PAID`. There is no check that the invoice belongs to
the session's unit. Any resident can pay off a neighbour's dues, or corrupt the ledger by
generating receipts against arbitrary invoices.

**Fix** — load the invoice scoped to the caller's unit, or verify ownership before writing.
Administrators recording a cash payment go through a separate, role-guarded path.

### D-08 · Login is impossible on AWS: `secure` cookie over plain HTTP
`infra/compute.tf:41-47,95-97`, `src/app/api/auth/login/route.ts:77`

The task's security group opens port 3000 to `0.0.0.0/0` and the task gets a public IP. There
is no load balancer, no certificate, no TLS. The task definition sets `NODE_ENV=production`,
and the login handler sets `secure: process.env.NODE_ENV === 'production'`.

A `Secure` cookie is not sent over `http://`. The deployment serves the login form, accepts
the credentials, sets a cookie the browser discards, and returns you to the login form. The
cloud build cannot authenticate anyone.

**Fix** — terminate TLS in front of the app. CloudFront gives a valid certificate with no
domain purchase; see 03.

### D-09 · Nothing is deployed — the task image is a bare Node image
`infra/compute.tf:73`

```hcl
image = "node:20-alpine" # Default or your ECR URI
```

There is no `Dockerfile` anywhere in the repository, no ECR repository in Terraform, and no
build step. The container starts, has no application, exits, and ECS restarts it forever.
`next.config.mjs` has a `DOCKER_BUILD` branch that emits `output: 'standalone'`, so the intent
existed; the image never did.

**Fix** — multi-stage `Dockerfile` on `output: 'standalone'`, ECR repository with a lifecycle
policy, image built and pushed before the service is updated.

### D-10 · Database master password in plaintext, in three places
`infra/variables.tf:25-30`, `infra/compute.tf:83-85`, `infra/outputs.tf:6-10`

`db_password` carries a committed default of `OneResiSecurePass2026!`. The value is
interpolated into a plain `environment` entry on the container definition, so it is readable in
the ECS console, in `describe-task-definition`, and in every retained task revision. Because
it is a Terraform variable it is also written into `terraform.tfstate`, which is local and
unencrypted (see D-33).

**Fix** — `manage_master_user_password = true` so RDS generates and rotates it into Secrets
Manager and the value never enters Terraform state. The container reads the connection string
through `secrets`, not `environment`.

### D-11 · The task has no IAM identity
`infra/compute.tf:62-68`

The task definition sets `execution_role_arn` and no `task_role_arn`. The execution role lets
ECS pull the image and write logs; it grants the application nothing. So even after switching
`STORAGE_DRIVER=s3` or `EVENT_DRIVER=sns`, every AWS call fails with no credentials. The S3
bucket and SNS topic Terraform creates are unreachable by design.

**Fix** — a task role with least-privilege policies for the specific bucket prefix, the
specific topic, SES `SendEmail` scoped to the verified identity, and the specific SSM paths.

### D-12 · Password hashes are served to browsers
`src/lib/mockDb.ts:314-352`, `src/app/api/admin/residents/route.ts:16-24`

Two independent leaks.

The mock's `enrich*` helpers ignore Prisma's `select`. `enrichUnit` attaches every resident row,
`enrichUser` attaches the unit which attaches those residents, and `enrichPass` attaches the
full creator row. So `select: { name: true, phone: true }` on the pass creator returns
`password_hash` as well — including to the shared gate device via `/api/visitors/verify`.

Separately, and this one leaks against real PostgreSQL too: `GET /api/admin/residents` runs
`findMany({ where: { role: 'R' } })` with no `select` and no `omit`, so every resident's bcrypt
hash is serialised to the admin browser.

**Fix** — the hash never leaves the data layer. Prisma `omit` on the model plus a mapping layer
that returns explicit view types; no handler ever returns a database row directly.

### D-13 · No server-side route protection at all
no `src/middleware.ts`; `(admin)/admin/page.tsx`, `(resident)/resident/page.tsx`, `(security)/security/page.tsx`

Every guard is a client `useEffect` that calls `/api/auth/me` and then `router.push`. The page
shell, the layout and the tab chrome render for any authenticated user before the redirect
fires. Role separation is a redirect, not a boundary.

**Fix** — `middleware.ts` verifies the session and the role before the route renders, plus a
server-side check inside each route segment. Client redirects become a fallback, not the
mechanism.

### D-14 · Fail-open authorisation gives Security the whole society
`api/complaints/route.ts:16`, `api/billing/invoices/route.ts:15`, `api/bookings/route.ts:17`, `api/visitors/passes/route.ts:17`

The same expression in four handlers:

```ts
where: session.role === 'R' && session.unitId ? { unit_id: session.unitId } : {}
```

Anything that is not a resident with a unit falls through to `{}` — an unfiltered read. The
shared gate account therefore receives every complaint description, every invoice and payment,
every booking, and every active pass code in the society. A resident whose `unitId` is null for
any reason gets the same.

**Fix** — deny by default. Build the filter from an explicit per-role branch with no fallback
arm, and cover each role with a test that asserts the row count it is allowed to see.

### D-15 · The mock and the real schema are two divergent implementations
`src/lib/mockDb.ts` vs `prisma/schema.prisma` vs `prisma/seed.ts`

They disagree on values, on field names, and on fixtures.

| | Mock store | Prisma schema |
|---|---|---|
| Unit type | seeds `'PLOT'`, `'VILLA'` | `BHK1 BHK2 BHK3 BHK4` only |
| Complaint status | seeds `'IN_PROGRESS'` | `OPEN ASSIGNED RESOLVED CLOSED` |
| Payment method | seeds `'SIMULATED_UPI'` | `ONLINE CASH CHEQUE` |
| Complaint update | seeds field `status` | column is `status_after` |

The fixtures differ too: the mock has 4 blocks, 7 units, 5 users, 3 facilities and pass code
`710384`; `seed.ts` has 2 blocks, 4 units, 5 users, 2 facilities and pass code `719302`, with
different facility names and different hourly rates. Switching database mode changes the demo
data underneath you.

The consequence is that mock mode is not a stand-in for the real thing — it is a different
system with different rules, and it is the one that has been exercised. Which is why D-16 is
true.

**Fix** — delete the parallel implementation. One Prisma client, one schema, one seed. Offline
mode becomes a different *driver* under the same client, not a different *client*.

### D-16 · The main registration path cannot run against PostgreSQL
`src/app/api/auth/register/route.ts:97`, `src/app/(auth)/register/page.tsx:291-292`

```ts
type: newUnitType || 'PLOT',
```

and the form's default selection is `PLOT`, with `VILLA` as the second option. Neither value
exists in the `UnitType` enum. Against real PostgreSQL this throws on insert and returns 500.
Against the mock it succeeds, because the mock does not validate anything.

So the primary path through the primary flow has only ever worked in mock mode. Treat this as
proof that the application has never been run against its own schema.

**Fix** — settle the enumeration (open question 3 in the README; my proposal in 02 is
`FLAT_1BHK … FLAT_4BHK`, `VILLA`, `PLOT`, `SHOP`), generate the option list from it, and
validate at the boundary so a bad value is a 400 rather than a 500.

### D-17 · Double billing is possible — the guaranteeing constraint is missing
`prisma/schema.prisma:210-223`, `src/app/api/billing/generate/route.ts:32-68`

`docs/data-model.md` is explicit that `UQ_INVOICE_UNIT_PERIOD UNIQUE (Unit_ID, Period)` "is
exactly right, and it is what makes UC-21's refusal to run twice for the same month a database
guarantee instead of an application check that a concurrent request could slip past."

The `Invoice` model has no `@@unique([unit_id, billing_period])`. The billing route does
exactly the application-level check the document warns about: `findFirst`, then `create`, per
unit, outside any transaction. Two administrators clicking at once produce two invoice sets.

**Fix** — add the composite unique index, wrap the run in one transaction, and let the
constraint violation be the refusal rather than the pre-check.

### D-18 · Double booking is possible, and the prescribed index has nowhere to live
`prisma/schema.prisma:250-264`, `src/app/api/bookings/route.ts:57-89`, no `prisma/migrations/`

ADR 0003 requires `UQ_BOOKING_SLOT` to be replaced by a partial unique index limited to live
bookings, and `data-model.md` gives the exact SQL, noting that Prisma cannot express it in
`schema.prisma` so it must go into a hand-edited migration.

There is no `prisma/migrations/` directory. Only `prisma db push` is wired up, which cannot
carry hand-written SQL. So the index does not exist, and there is no place to put it. The
overlap check in the booking route is a `findFirst` followed by a `create` with nothing
serialising them.

**Fix** — adopt `prisma migrate`, commit the migration history, and add the partial index as
hand-written SQL in a migration. Keep the application-level check for the friendly error
message, but rely on the constraint for correctness.

## S2 — High

### D-19 · The provisioned database would have no tables
`infra/deploy.ps1`, `infra/compute.tf`

`deploy.ps1` runs `init`, `validate`, `plan`, `apply`, then prints "Provisioning complete". No
step creates the schema. Nothing runs `prisma migrate deploy`. RDS is `publicly_accessible =
false` in private subnets, so it is also unreachable from your laptop — there is no bastion, no
VPC endpoint, no session-manager path.

An empty database, an unreachable database, and an application that would have used the mock
anyway.

**Fix** — a one-off ECS task in the same VPC that runs migrations and the idempotent seed,
invoked by Terraform after the instance is available and before the service scales up. Detailed
in 03.

### D-20 · Complaint resolution timestamps are destroyed by the next update
`src/app/api/complaints/[id]/update/route.ts:86-93`

```ts
resolved_at: status === 'RESOLVED' || status === 'CLOSED' ? new Date() : null,
```

Every update that is not a resolution writes `null`. So: administrator resolves a ticket
(`resolved_at` set) → administrator adds any follow-up note with status `ASSIGNED` →
`resolved_at` becomes null → the seven-day reopen window UC-07 measures from that timestamp is
gone permanently, and the reopen guard at line 37 silently passes forever.

`data-model.md` added `resolved_at` specifically because "the seven-day reopen window is
measured from resolution".

**Fix** — set `resolved_at` on the transition into a resolved state and never clear it except
on an explicit reopen. Status changes belong in a state machine, not in a ternary.

### D-21 · Walk-in decisions record no decider
`src/app/api/visitors/walkin/route.ts:89-95`

The PATCH handler writes `approval_status` and `entry_time`. It never writes `decided_by` or
`decided_at`. Both columns were added to the schema for exactly this purpose — ADR 0003 lists
"`approval_status`, `decided_by` and `decided_at` on `VISITOR_LOG`, required by UC-05".

So there is no record of which resident admitted a visitor. For a gate audit log that is the
one fact worth having.

**Fix** — write both in the same update, and make them non-null whenever
`approval_status` is `APPROVED` or `REJECTED`.

### D-22 · Password reset is a dead end that emails a 404
`src/app/api/auth/forgot-password/route.ts:17-27`

The route generates a token, puts it in a link, sends the mail, and discards it. Neither
`reset_token_hash` nor `reset_expires_at` is ever written, despite both existing in the schema
for this flow. The link points at `/reset-password`, and there is no such page in the
application.

The token itself is `rst_${Date.now()}_${Math.random().toString(36)}` — predictable — and the
link is hardcoded to `http://localhost:3000`, so a deployed build emails residents a localhost
address.

**Fix** — store a hash of a `crypto.randomBytes(32)` token with a 15-minute expiry, single use,
build the URL from configuration, and implement the reset page.

### D-23 · Password change does not invalidate sessions
`src/lib/auth.ts:36-49`

`password_changed_at` exists in the schema because ADR 0003 requires UC-03's
session-invalidation postcondition. Nothing reads it. `verifySessionToken` checks the signature
and expiry and returns the payload.

**Fix** — carry the timestamp in the token and reject any token issued before the user's
current `password_changed_at`.

### D-24 · Sign-out does not sign anyone out, and disabling an account takes a week
`src/app/api/auth/logout/route.ts:4-8`, `src/lib/auth.ts:51-56`

Logout deletes the cookie in the response. The JWT remains valid for its full seven days, so a
copied token keeps working. And because the session is decoded rather than looked up, a user an
administrator sets to `DISABLED` keeps full access until the token expires — which makes UC-18
and UC-19's deactivation ineffective.

**Fix** — resolve the user's current `status` on each request (cheap, indexed, cacheable per
request), shorten the access token to 15 minutes with a refresh cookie, and keep a revocation
list keyed by token id for explicit sign-out.

### D-25 · `$transaction` in mock mode is not a transaction
`src/lib/mockDb.ts:797`

```ts
$transaction: async (cb: any) => cb(mockPrisma),
```

The callback runs against the same store with no isolation and no rollback. Payment
confirmation, complaint updates and their audit rows are all written under this. A failure
halfway leaves a payment row against an unpaid invoice.

The payment modal tells the resident it is "inside an atomic database transaction" while
running under this shim.

**Fix** — falls out of D-15. One client, real transactions on both targets.

### D-26 · Receipts are fabricated in the browser
`src/app/(resident)/resident/page.tsx:698-706`

When an invoice is `PAID` but its `payments` array is empty, the receipt button synthesises the
document: `receipt_no: REC-${billing_period}-001`, `gateway_order_id: sim_ord_${invoice_id}`,
`amount_paid` copied from the invoice, `payment_date: new Date()`.

The application prints a financial receipt with invented identifiers and today's date. That is
not a rendering bug.

**Fix** — no receipt without a persisted payment row. Render it server-side from the payment
record; if there is none, show why.

### D-27 · The mock ignores most of the query it is given
`src/lib/mockDb.ts` throughout

`findMany` implementations recognise one or two hardcoded `where` keys and drop everything
else. `select`, `include`, `orderBy`, `take` and `skip` are ignored; ordering is an arbitrary
`.reverse()`. `invoice.updateMany` ignores `args` entirely and hardcodes the overdue rule.
`payment.findMany` ignores `args` and returns every payment. `facility.findMany` always filters
to active, so an administrator can never list a deactivated facility for UC-22.

A filter the mock does not recognise silently becomes an unfiltered read. That is the same
defect class as D-14, arriving from the data layer instead of the handler.

**Fix** — falls out of D-15.

### D-28 · Identifiers are assigned from array length
`src/lib/mockDb.ts:396,423,473,514,553,589,614,647,687,710,759,787`

`id: store.things.length + 1` in twelve create methods. Concurrent creates collide; any removal
produces duplicates. Foreign keys then point at the wrong rows.

**Fix** — falls out of D-15.

### D-29 · Notification loops will time out, and the pipeline built to prevent that is missing
`src/app/api/billing/generate/route.ts:32-68`, `src/app/api/notices/route.ts:61-75`

Billing iterates units and, per unit, runs a `findFirst`, a `create`, a `findMany` for
residents, and then `await`s one email per resident inside the loop. Posting a notice `await`s
one email per active resident sequentially. At 200 units or 300 residents this is many hundreds
of serial round-trips inside a single HTTP request.

`docs/architecture.md` designs SNS → SQS → a notifier Lambda precisely so that "the monthly
invoice run cannot fail because SES was down", and notes that UC-29 alternative flow 3a
requires the caller to complete even when mail fails. None of it is built (D-35). The route
does the thing the architecture exists to avoid.

Two further bugs in the same loops: the billing run reports a partial count where the
architecture says it must refuse outright if any invoice exists for the period; and in mock mode
`residentUser.findMany` only filters `role`, so every resident in the society is emailed for
every unit's invoice, including pending and disabled accounts.

**Fix** — transactional outbox. Handlers write an `outbox` row in the same transaction as the
domain change and return. A worker drains it — SQS plus a Lambda on AWS, an interval worker
locally. Same contract both sides.

### D-30 · The AWS providers do not call AWS
`src/lib/email.ts:84-109`, `src/lib/storage.ts:31-48`, `src/lib/events.ts:30-36`, `package.json:17-29`

`SESEmailProvider.sendEmail` writes a console line and appends to a JSON file. `S3StorageProvider.uploadFile`
logs a fabricated `s3://` URL and returns a public-looking HTTPS URL for an object it never
uploaded; the actual SDK calls are commented out. `SNSEventBus.publish` logs the topic ARN.

There is no `@aws-sdk/*` package in the dependency list, and no `nodemailer` either, though ADR
0001 commits to Nodemailer over SES SMTP. So "AWS mode" is a set of stubs that report success.
Switching drivers in production would silently drop every email, every upload and every event.

**Fix** — real clients, and an integration test per provider that runs against the deployed
account and asserts the object exists, the message was accepted, and the event arrived (05).

### D-31 · State that must survive is written to the container filesystem
`src/lib/email.ts:25-44`, `src/lib/storage.ts:9-29`, `src/lib/mockDb.ts:23,298-307`

Three stores in `process.cwd()`: `.dev_emails.json`, `public/uploads/`, `.dev_store.json`. On
Fargate that is ephemeral, per-task storage. Uploads vanish on every redeploy; the admin outbox
screen is empty after every deploy and shows a different subset per task.

Each write is a full read-modify-write with `writeFileSync` on the request path, so concurrent
requests lose each other's data, and the store cache is held on `globalThis` and only read from
disk once.

`storage.ts` also runs `mkdirSync` at module load — an import-time side effect that fails on a
read-only filesystem and during build.

**Fix** — mail history is a database table (which the mail test suite then asserts against);
uploads are S3 with presigned PUT and GET as `architecture.md` specifies, and a local disk
adapter behind the same interface for offline mode.

### D-32 · RDS has no backups, no encryption, and a pinned patch version
`infra/database.tf:38-58`

- `backup_retention_period` unset, so it defaults to 0 and automated backups are **off**.
  `architecture.md` states "recovery is a restore from automated snapshot". There are none, and
  `skip_final_snapshot = true` means a destroy leaves nothing either.
- `storage_encrypted` unset, so it defaults to false. Encryption at rest is free.
- `engine_version = "16.3"` pins a patch release AWS will eventually deprecate, at which point
  `apply` fails.
- No parameter group, so `rds.force_ssl` is not set and the connection can be plaintext.
- `max_allocated_storage` equals `allocated_storage`, which is a no-op rather than a cap.

**Fix** — 7-day retention, `storage_encrypted = true`, `engine_version = "16"` with
`auto_minor_version_upgrade`, a parameter group forcing SSL, and `sslmode=require` in the
connection string.

### D-33 · Terraform state is local and the lock file is gitignored
`infra/main.tf:1-9`, `.gitignore:19-26`

No `backend` block, so state is a file on your laptop. `architecture.md` describes an S3 backend
with native locking (`use_lockfile = true`). Losing that file means losing the ability to
destroy the stack, which for a student account is a runaway-cost event.

`.gitignore` also excludes `.terraform.lock.hcl`, which is the opposite of the intent — the
provider lock file should be committed so a plan is reproducible.

Note: native S3 locking needs Terraform 1.10 or later; you have 1.9.8 (D-79).

**Fix** — S3 backend with versioning and `use_lockfile`, created by a tiny bootstrap stack that
is applied once with local state. Commit the lock file.

### D-34 · `enable_alb` is a variable nothing reads
`infra/variables.tf:44-48`

Declared, documented, defaulted to `false`, and referenced in no resource in any file. There is
no ALB, no target group, no listener, no ACM certificate. The architecture document's diagram,
its claim that the task's security group "accepts traffic only from the load balancer's security
group", and the synchronous request path sequence all describe infrastructure that does not
exist.

**Fix** — see 03. CloudFront plus an ALB, both in Terraform, no dead flags.

### D-35 · Two thirds of the documented architecture is not in Terraform
`infra/*.tf` vs `docs/architecture.md`

Documented and absent: the notifier Lambda, the overdue-flag Lambda, the SQS queue, the dead
letter queue, EventBridge Scheduler, SSM Parameter Store parameters, ECR, the load balancer, and
every SES resource. Present but orphaned: the S3 bucket (nothing writes to it) and the SNS topic
(no publisher, no subscription).

The gap matters for the report as much as for the build: the submitted architecture slide and
this document describe a system that was never provisioned.

**Fix** — 03 provisions all of it, and adds a check that fails CI when a service named in
`architecture.md`'s service-selection table has no corresponding resource.

### D-36 · The overdue job is an unauthenticated endpoint nothing calls
`src/app/api/cron/overdue/route.ts:6-31`

`POST /api/cron/overdue` has no session check, no shared secret, no source restriction. Anyone
can invoke it. Nothing schedules it — there is no EventBridge rule and no Lambda.

It is also off by one: `due_date: { lt: now }` against a `DateTime` column holding midnight means
an invoice due today is flagged `OVERDUE` at 00:01 on its own due date.

**Fix** — the logic moves into a scheduled Lambda inside the VPC; the HTTP surface disappears.
The comparison becomes "due date is strictly before today" in the society's timezone.

### D-37 · Security tokens come from `Math.random()`
`src/lib/utils.ts:37-45`, `api/auth/forgot-password/route.ts:17`, `api/payment/simulate/route.ts:44`

Gate pass codes, password reset tokens, receipt numbers and payment order identifiers all derive
from `Math.random()`, which is not a cryptographic source and is seeded predictably per process.
A six-digit gate code is a bearer credential; a reset token is a password equivalent.

`generateReceiptNo` is date plus four random digits against a `UNIQUE` column, so collisions are
a 500 rather than a retry.

**Fix** — `crypto.randomInt` for codes, `crypto.randomBytes` for tokens, and a monotonic
per-period sequence for receipt numbers so they are unique by construction and readable.

### D-38 · Unbounded loop searching for a free pass code
`src/app/api/visitors/passes/route.ts:60-66`

```ts
while (!isUnique) { ... }
```

No attempt cap. One database round-trip per attempt. As the table fills, the loop lengthens; at
saturation it never ends and the request hangs holding a connection.

**Fix** — insert optimistically and retry on unique violation, capped at five attempts, then
fail loudly. Widen the code space if collisions ever matter.

### D-39 · No validation anywhere, and internal errors are returned to clients
every route under `src/app/api/`

Zod is a dependency and is imported by nothing. Bodies are destructured from `req.json()` and
used directly: `email.toLowerCase()` throws if `email` is not a string, `parseInt(passId, 10)`
yields `NaN` which Prisma rejects, enum fields like `category`, `priority` and `status` are
passed straight into the database.

Then fourteen handlers end with `{ error: error.message }`, so Prisma's messages — table names,
column names, constraint names, sometimes parameter values — are serialised to the browser. A
validation failure and an internal failure are indistinguishable to the client, and both are 500.

**Fix** — one Zod schema per endpoint, shared with the client for form validation; a single error
mapper that turns known domain errors into stable codes and everything else into an opaque 500
with a correlation id in the log.

### D-40 · The gate admits cancelled and expired passes
`src/app/api/visitors/verify/route.ts:21-41,68-82`, `src/app/(security)/security/page.tsx:373-386`

The verify endpoint looks the code up and returns the row. It does not check `status`, does not
check `valid_date` against today, and does not check whether the pass has already been used —
all three of which `architecture.md`'s sequence diagram lists as steps 8 and 9.

The kiosk then renders whatever comes back inside a card with an emerald border, a tick, and the
heading **"Valid Pre-Authorized Pass"**. A `CANCELLED` pass from last month displays as valid.

`CHECK_IN` has the same gap: no state check, so a cancelled pass can be stamped in, repeatedly,
each time writing another log row and re-setting the pass to `USED`. Neither is wrapped in a
transaction.

This is the tightest requirement in the SRS — a correct result within two seconds — and it
returns the wrong answer.

**Fix** — the endpoint returns a decision (`ADMIT`, `REFUSE`, with a reason), not a row. The UI
renders the decision. Check-in is a guarded transition inside a transaction, idempotent per pass.

### D-41 · Exported reports are a spreadsheet injection vector
`src/app/api/admin/reports/route.ts:45,82,130`

Cells are quote-escaped for CSV but not neutralised for formula evaluation. A resident whose
complaint description begins `=`, `+`, `-` or `@` gets that text executed when the administrator
opens the export in Excel. Complaint descriptions and walk-in details are free text from
untrusted users.

Also: no UTF-8 BOM, so rupee symbols and Indian names are mangled in Excel; the whole table is
loaded and concatenated into one string with no date filter or paging; and `architecture.md`
specifies these exports go to S3 with a presigned GET, which is not what happens.

**Fix** — prefix any cell starting with a formula character with a single quote, emit a BOM,
stream the response, and accept a date range.

### D-42 · Occupancy flags drift permanently, and drift bills
`src/app/api/admin/residents/route.ts:54-60`

Approving a resident sets `unit.occupied = true`. Rejecting or disabling one never sets it back.
The billing run selects `where: { active: true, occupied: true }`, so a unit whose only resident
was later rejected is invoiced every month forever.

The same handler has no check that the target is a resident, so an administrator can disable the
other administrator or the gate account — or themselves, locking the society out.

**Fix** — derive `occupied` from a count of active residents rather than storing a flag that can
desynchronise, or recompute it on every status transition. Guard the role of the target.

### D-43 · bcrypt cost 10, ADR 0001 commits to 12
`src/lib/auth.ts:21`, `src/lib/mockDb.ts:6`, `prisma/seed.ts:84`

Three places hash at cost 10. ADR 0001 states "bcrypt at cost 12" as an application-tier choice
carried unchanged from the submitted deck.

`mockDb.ts:6` also runs `bcrypt.hashSync` at module load, blocking the event loop on every cold
start.

**Fix** — one constant, cost 12, in one place. Async only.

### D-44 · Password hashes are committed to git
`.gitignore`, `app/.dev_store.json`

`.dev_store.json` and `.dev_emails.json` are not ignored. The former exists on disk right now,
12 KB, containing five users with their bcrypt hashes and every visitor pass code.

**Fix** — ignore both, and move the offline store under a directory that is ignored wholesale.

### D-45 · The seed is only half idempotent
`prisma/seed.ts:212-285`

Blocks, units, users, facilities and passes use `upsert`. Complaints, complaint updates,
invoices, the payment and the announcements use `create`. Running the seed twice duplicates the
complaints and announcements and throws on the payment's unique `receipt_no`.

**Fix** — natural keys and `upsert` throughout, so the seed is a convergent operation you can run
on every boot.

### D-46 · Six enumerations and one column drifted from the reconciled model
`prisma/schema.prisma` vs `docs/data-model.md`

| Model | `data-model.md` | `schema.prisma` |
|---|---|---|
| ComplaintStatus | `OPEN IN_PROGRESS RESOLVED CLOSED` | `OPEN ASSIGNED RESOLVED CLOSED` |
| InvoiceStatus | `UNPAID PAID OVERDUE CANCELLED` | `CANCELLED` missing |
| BookingStatus | `… CANCELLED COMPLETED` | `COMPLETED` missing |
| PaymentMethod | `UPI CARD NETBANKING CASH` | `ONLINE CASH CHEQUE` |
| Announcement | `expires_at` | **column absent** |
| Invoice | `period` | renamed `billing_period` |
| Complaint | — | `priority` added |
| ComplaintUpdate | `remark`, `status`, `updated_at` | `update_text`, `status_after`, `created_at` |
| Facility | `slot_timings`, `booking_rules` | `open_time`, `close_time`, `hourly_rate` |
| Booking | `slot` | `start_time`, `end_time` |

`expires_at` is the one with a functional consequence: UC-24 requires announcements to expire and
the column no longer exists, so they cannot. `INVOICE.status` losing `CANCELLED` removes the only
way to void a wrongly generated invoice.

Some of these drifts are improvements — `start_time`/`end_time` is better than a `slot` string,
and `priority` is a reasonable addition. The problem is that none of them are recorded, so the
report's ER figure and the running schema disagree with no errata list.

**Fix** — decide each one, regenerate `oneresi_ddl.sql` from the decision, and extend the delta
tables in `data-model.md` so the difference is documented rather than discovered.

### D-47 · Deleting an administrator deletes the financial and audit history
`prisma/schema.prisma:163,207,221,276`

`onDelete: Cascade` on `VisitorPass.creator`, `ComplaintUpdate.updater`, `Invoice.generator` and
`Announcement.publisher`. These are attribution links to the *acting* user, not ownership links.
Removing one administrator account deletes every invoice they generated, every complaint update
they wrote, and every notice they published.

**Fix** — `onDelete: Restrict` on attribution links. Staff accounts are disabled, never deleted.

### D-48 · No index on any foreign key
`prisma/schema.prisma`

PostgreSQL does not index foreign keys automatically. There is not one `@@index` in the schema.
Every per-unit list, every complaint timeline, every invoice lookup and every dashboard aggregate
is a sequential scan.

**Fix** — index `unit_id` on the five tables that carry it, `complaint_id`, `invoice_id`,
`facility_id + booking_date`, `pass_id`, and `(status, due_date)` for the overdue job.

### D-49 · The stack cannot be created twice
`infra/*.tf`

`var.environment` exists and is used only inside tag maps. Every resource name is prefixed with
`var.project_name` alone — the RDS identifier, the security group names, the cluster, the log
group, the budget. A second environment, or a second workspace, collides on all of them.

**Fix** — one local `name_prefix = "${var.project_name}-${var.environment}"` used by every
nameable resource.

### D-50 · Money is a float in some places and a Decimal in others
`src/lib/utils.ts:8-15`, `resident/page.tsx:435`, `billing/generate/route.ts:60`

`Decimal(10,2)` in PostgreSQL, plain JavaScript numbers in the mock. The client does
`parseFloat(i.amount)` and sums the results to show outstanding dues; the billing email does
`Number(unit.monthly_charge).toFixed(2)`. So the same amount is a Decimal, a string, and a float
at different points in one flow.

**Fix** — integer paise in the database and in every contract. One formatter at the edge. Nothing
in the domain layer sees a fraction.

## S3 — Reads as coursework, not software

### D-51 · Use-case identifiers are printed in the interface and in outbound mail
`(admin)/admin/page.tsx` (43 occurrences), `(resident)/resident/page.tsx` (~20), `(security)/security/page.tsx` (~10), plus six email subjects

Headings, buttons, tab labels and modal titles carry them: "Resident Registration Verification
(UC-19)", "GATE APPROVAL REQUIRED (UC-05)", "Cancel Slot (UC-12)", "Receipt (UC-10)", "Simulated
Online Payment (ADR 0002)", "Rapid Pass Verification (UC-14)", "Log Walk-in Visitor (UC-16)".

They are in email subject lines too: `OneResi - Password Reset Request (UC-03)`, `[OneResi Notice]
… (UC-24)`, `OneResi - Maintenance Invoice for 2026-09 (UC-21)`.

A security guard at a gate sees requirement identifiers on the buttons. This single pattern is
the strongest signal that the application is a coursework artifact rather than a product, and it
is the first thing to remove.

**Fix** — every identifier moves to a code comment or a traceability table in `docs/`. A build
gate (04) fails the build if `UC-\d`, `ADR`, `BCSE` or a register number appears under `apps/`.

### D-52 · The payment screen explains itself to the resident
`(resident)/resident/page.tsx:1162-1164`

> ℹ️ **Coursework Simulation:** Processes the settlement in-process inside an atomic database
> transaction. No real money or KYC required.

Rendered inside the payment modal, above the confirm button. It tells the user this is
coursework, describes an implementation detail, and the detail is false in the mode the app
actually runs in (D-25).

**Fix** — delete. The payment sheet shows the amount, the unit, the period, and one button.

### D-53 · Demo scaffolding is permanent interface
`page.tsx:106-114`, `login/page.tsx:200-227`, `register/page.tsx:183`, `security/page.tsx:356-360`

"Instant Demo Sign-in" · "Dev Credentials Active" · "v1.0 Live" · "BCSE301L Software Engineering
System Implementation" · "Click to Autofill Demo Credentials" with three role pills · **"Select
Seeded Unit"** as a form label the resident reads · **"Try 492815"** as a permanent button in the
gate kiosk.

"Select Seeded Unit" is the worst of them: the product tells the resident its own data is fake.

**Fix** — all of it goes. Development affordances live behind a dev-only route.

### D-54 · "Simulated" appears seven times in the payment flow
`(resident)/resident/page.tsx:446,689,1099,1108,1126,1171` and the button label

"Pay Now (Simulated)", "Pay Online (Simulated)", "Simulated Online Payment (ADR 0002)", "marked
as PAID via simulated transaction", "SIMULATED ONLINE", "Simulating Settlement…", "Confirm
Simulated Payment (UC-09)".

ADR 0002's decision is that payment is simulated. That is an engineering decision, not a message
for the resident. The resident's flow should read like paying a bill.

**Fix** — the resident sees "Pay ₹3,500". The method shown on the receipt is a real method
(`UPI`), and the fact that no gateway is involved is documented in the ADR and the report, where
it belongs.

### D-55 · Raw enumeration values are shown to users
throughout; `components/ui/Badge.tsx:42-58`

`BHK2`, `PLOT`, `NOT_REQUIRED`, `COMMON_AREA`, `ASSIGNED` render as-is. `StatusBadge` uppercases
whatever string it is given and matches it against four hardcoded lists, so `BHK1` — a unit
*type* — is treated as a warning status, and `IN_PROGRESS` from the mock falls through to the
default blue.

The same component is used for `priority`, so `MEDIUM` renders as informational blue and `HIGH`
as danger red through a component named for status.

**Fix** — one label map per enumeration, defined next to the enumeration, with a display label,
a tone, and an icon. Separate `StatusBadge` from `PriorityBadge`.

### D-56 · `alert()` and `confirm()` are the feedback mechanism
`security/page.tsx:151,171,175`, `resident/page.tsx:125,127,227,242`

Native browser dialogs for walk-in decisions, booking cancellation, gate actions and errors. They
block the page, cannot be styled, look different on every platform, and on the installed PWA they
are jarring.

**Fix** — a toast system with an undo affordance for reversible actions, and a proper confirm
dialog for destructive ones.

### D-57 · There is no design system
`src/components/ui/` — three files, 196 lines, against 7,400 lines of application code

`Badge`, `Modal`, `Navbar`. No button, input, select, textarea, card, table, sheet, tabs, toast,
skeleton, empty state or field. So every one of those is re-declared as an inline Tailwind string
in each of the five pages, which is why the same input appears with `text-xs` in one place and
`text-sm` in another, `rounded-lg` here and `rounded-xl` there, `py-2` and `py-2.5` alongside each
other.

Visual inconsistency at this density is itself the "generated" signal — a human building screen
after screen converges on a component; a generator re-derives the classes each time.

**Fix** — 04.

### D-58 · Animation classes that do nothing
`Modal.tsx:32`, `security/page.tsx:374`, `resident/page.tsx:316`

`animate-in fade-in duration-200` is `tailwindcss-animate` syntax. The plugin is not in
`package.json` and `tailwind.config.ts` has `plugins: []`. The classes compile to nothing, so
every modal and every result card appears instantly.

Code written against a dependency that was never installed is a strong indication it was never
run.

**Fix** — real motion, specified in 04.

### D-59 · Theme tokens defined and never used
`tailwind.config.ts:12-26,9`

A full `brand` colour scale from 50 to 950 is declared. Nothing references `brand-*`; every file
hardcodes `emerald`, `slate`, `rose`, `amber`, `indigo`. `darkMode: 'class'` is configured and
there is no dark styling and no toggle. `globals.css` defines `--background` and `--foreground`,
which the `<body>` class then overrides.

Three competing styling systems, none of them load-bearing.

**Fix** — one token layer, semantic names, used everywhere; dark mode built or the option removed.

### D-60 · The entire application is set at 11 and 12 pixels
every page

`text-xs` and `text-[11px]` are the dominant sizes, with `text-[10px]` for badges. Body copy,
labels, table cells, error messages and button text are all the same size, so nothing establishes
hierarchy — headings are distinguished only by weight.

On a phone, which is the stated PWA target, 11px body text is unreadable and fails WCAG for
minimum size and, at `slate-400` on white, for contrast.

**Fix** — a type scale with four steps and one body size no smaller than 15px on mobile, plus a
contrast check in the a11y suite.

### D-61 · No motion of any kind
`package.json`, `globals.css`

No animation library. No `@keyframes`. No transitions beyond Tailwind's `transition-colors` on
hover. No `prefers-reduced-motion` handling. Screens replace each other instantly, modals appear
without transition, lists snap in.

**Fix** — the motion specification is 04. This is the requirement about weight in screen changes.

### D-62 · It is not a PWA
`src/app/layout.tsx:4-7`, `public/`

No `manifest.webmanifest`. No service worker. No offline handling. No `themeColor`, no `viewport`,
no `appleWebApp` metadata, no icon set, no maskable icon, no splash screens. `public/` contains
one favicon.

It cannot be installed, it does not work offline, and on a phone it is a website in a browser tab.

**Fix** — 02 and 04.

### D-63 · The logo is hand-rolled four times, and the favicon is text
`page.tsx:53`, `Navbar.tsx:36`, `login/page.tsx:112`, `register/page.tsx:122`, `src/app/icon.svg`

Four independent copies of a green rounded square containing the characters `1R`, each with
slightly different sizes and shadows. `icon.svg` renders the same thing as SVG `<text>` in a
system font stack — so the favicon rasterises differently on every machine, and in some contexts
not at all.

**Fix** — one designed mark as a path-based SVG, one component, one generated icon set. 04 covers
the mark itself, which you asked for.

### D-64 · Tab state is not in the URL
`resident/page.tsx:36`, `admin/page.tsx:37`, `security/page.tsx:41`

Thirteen tabs across three dashboards, all held in `useState`. No deep links, nothing shareable,
no browser history. On the installed app the back gesture exits instead of leaving the tab.

`security/page.tsx` also declares a third tab value, `'logs'`, that no button ever sets.

**Fix** — tabs become routes.

### D-65 · Two components carry the whole product
`admin/page.tsx` 1,376 lines · `resident/page.tsx` 1,244 lines

Both are single `'use client'` components. The admin page holds 33 `useState` hooks, 21 `fetch`
calls and seven tab bodies; the resident page holds six tab bodies and six modals. Every modal,
every table and all twenty-plus icons ship to every user regardless of what they open.

**Fix** — server components for reads, route segments per tab, client islands only where there is
interaction.

### D-66 · Every mutation refetches everything
`resident/page.tsx:93-101,148,171,195,217,239,261`

`fetchAllData()` issues seven parallel requests on mount and is called again after every single
mutation. Creating one visitor pass refetches passes, invoices, complaints, facilities, bookings,
notices and pending walk-ins. There is no cache, no request deduplication, no targeted
invalidation.

**Fix** — server-side data loading per route, with mutations revalidating only the affected path.

### D-67 · A failed request looks exactly like empty data
`resident/page.tsx:94-99`, `security/page.tsx:84-97`

```ts
fetch('/api/complaints').then(r => r.json()).then(d => d.complaints && setComplaints(d.complaints));
```

Thirteen fetches in this shape. No `.catch`, no status check. A 500 leaves the array empty and the
UI renders "No complaints filed for your flat." The user is told there is nothing there when in
fact the request failed.

**Fix** — three distinct states everywhere: loading, empty, failed. Failed states say what failed
and offer a retry.

### D-68 · The waiting-visitor alert never arrives
`resident/page.tsx:104-111,67-69`, `security/page.tsx:83-87,453`

`fetchPendingWalkins` runs once on mount. A visitor who arrives while the resident already has the
app open is never shown — the resident has to reload. The kiosk's panel is headed **"Live Gate Log
Stream"** and is refreshed only by a manual button.

This is the failure you described: someone registers, and there is no way for anyone to notice
without going and looking. The same is true of the walk-in approval that UC-05 depends on.

**Fix** — server-sent events for the two live surfaces (gate approvals, gate log), Web Push on the
installed app, and an in-app notification centre backed by a table. The outbox worker (D-29) is
what feeds them.

### D-69 · "Print receipt" prints the dashboard
`resident/page.tsx:1226`

`window.print()` with no print stylesheet — `globals.css` has no `@media print`. So the output is
the entire dashboard with the modal overlay across it.

**Fix** — a dedicated receipt route that renders server-side and prints cleanly, plus a PDF
download. This is the receipt document you asked for.

### D-70 · No loading, empty, focus or accessibility work
`Modal.tsx`, all pages

Each dashboard has one loading state: the words "Loading Resident Portal…" for the whole page. No
skeletons, no optimistic updates, no per-row pending states.

`Modal` has no focus trap, no `role="dialog"`, no `aria-modal`, no `aria-labelledby`, and does not
restore focus on close. Backdrop clicks discard unsaved forms without asking. Setting
`document.body.style.overflow = 'unset'` on cleanup breaks scroll locking if two modals ever
overlap. Error regions have no `aria-live`, so screen readers announce nothing when a submission
fails.

**Fix** — 04, with an automated a11y pass in CI.

### D-71 · No progress, no steps, no draft, no pre-filling
`register/page.tsx`

Eight-plus fields in one column with a mode toggle that swaps a sub-form. No stepper, no progress
indicator, no saved draft, no inline validation, no async email-availability check, no password
confirmation, no strength meter. `minLength={6}` on the client with no server policy at all.

Nothing anywhere in the application pre-fills anything — not the last-used visit purpose, not a
frequent visitor, not the previous facility and slot, not the guard's last unit.

These are the two things you asked for by name.

**Fix** — 04 specifies the stepper, the resumable draft, and pre-filling per surface.

### D-72 · Advertised rules are never enforced
`resident/page.tsx:816-817,1063-1084,927-933`

Facility cards display opening hours and an hourly rate. Bookings validate neither: no check
against `open_time`/`close_time`, no check that the end is after the start, no maximum duration,
no `min` on the date input, and the `hourly_rate` is never used in any calculation — a booking
costs nothing. Visitor passes also accept a past date.

The interface states rules the system does not apply.

**Fix** — the domain layer owns the rules, the API enforces them, and the form disables what is
not permitted rather than letting it be submitted.

### D-73 · No `autoComplete` on any input
`login/page.tsx`, `register/page.tsx`, every modal form

Not one `autoComplete` attribute in the codebase. Password managers cannot fill the login form,
iOS and Android will not offer saved credentials, and the registration form gets no address-book
assistance. On the installed app, where typing is expensive, this is a daily cost.

Also missing: `inputMode="numeric"` on the gate code field — the single most-used input in the
product, on a tablet, without a numeric keypad — and `enterKeyHint` anywhere.

**Fix** — correct `autoComplete` tokens, `inputMode`, `enterKeyHint`, and a segmented one-time-code
input for the gate.

### D-74 · Dead code and unused imports
`security/page.tsx:5,6,8,18,23,54`

`Navbar` and `StatusBadge` are imported and never rendered — the kiosk has its own inline header.
`formatDate` is imported and unused. `Clock` and `Calendar` are imported and unused. `inputRef` is
declared, attached, and never read, so the field is not focused on load. The `'logs'` tab value is
unreachable (D-64).

**Fix** — lint with `noUnusedLocals` and unused-import rules failing the build.

### D-75 · The test suite cannot fail
`app/test_suite.ps1`

118 lines of PowerShell that prints, unconditionally:

```
ALL 29 SPECIFICATION CHECKS PASSED 100%!
```

There is one real assertion in the file — a `try`/`catch` confirming a pending user cannot sign in.
Everywhere else, `Write-Host "   PASS: ..."` runs immediately after the request with no check of
the response. Line 56 prints "Security verified code in <2s!" without timing anything. Because
`$ErrorActionPreference` is not set to continue, any failure aborts the script, so the only two
outcomes are "everything passed" or a raw stack trace.

It covers roughly 14 use cases, not 29. It needs a running dev server, mutates the shared dev
store, and cannot be run twice — the second run's registration returns 409 and the script dies. It
has hardcoded dates that expire and a hardcoded facility id. It asserts nothing about email. It is
Windows-only, so the CI pipeline `architecture.md` describes as running `vitest` has nothing to
run, and no `vitest` is installed.

**Fix** — 05, in full. This is the other thing you asked for by name.

## S4 — Process and environment

### D-76 · ADR 0003 is unaccepted and already contradicted
`docs/adr/0003-schema-source-of-truth.md`

Status is "Proposed · awaiting Ashvin's decision". The schema has meanwhile diverged from it in
both directions — it adopted the added columns and enumeration values, and it omitted both unique
indexes the ADR turns on (D-17, D-18).

**Fix** — accept it with the amendments in D-46, or amend it. Then make the schema match.

### D-77 · Open decisions were closed silently, in code
`docs/architecture.md` "Open decisions" 1-5

Five decisions are listed as unresolved. At least one has been decided in the implementation
without being recorded: `register/route.ts:122` enforces a maximum of six occupants per unit, with
a comment attributing it to UC-02, in a single route, as a literal. `data-model.md` states plainly
that "no document states" this number.

`UNIT.Type` becoming a fixed enumeration was also decided in code, and got it wrong (D-16).

**Fix** — answer all five in 02, record them, then implement from the record.

### D-78 · The AWS CLI defaults to the wrong region
`~/.aws/config`

`region = us-east-1`, while Terraform, the application and every document target `ap-south-1`.
Account `215671569291`, IAM user `Ashvin`, long-lived access keys.

This will bite specifically on SES: an identity verified without `--region ap-south-1` is verified
in Virginia and the Mumbai deployment cannot send from it. Same trap for ECR logins and log
tailing.

**Fix** — set the default to `ap-south-1`, and pass `--region` explicitly in every script anyway.

### D-79 · A stale Terraform on PATH shadows the installed one
`~/bin/terraform`

`architecture.md` specifies `use_lockfile = true` on the S3 backend, which requires Terraform 1.10
or later. `terraform version` reports **1.9.8**, so the documented backend cannot apply.

Corrected after checking the machine: this is not a missing upgrade. Three binaries exist —

| Path | Version |
|---|---|
| `~/bin/terraform` | **1.9.8** — first on PATH, so this is the one that runs |
| `C:/Developer/Code/terraform_bin/terraform.exe` | 1.15.7 |
| winget package directory | **1.15.8** |

1.15.8 is already installed. A stale copy in `~/bin` takes precedence over it, which is why every
`terraform` invocation fails the version constraint with "Unsupported Terraform Core version".

**Fix** — remove or rename `~/bin/terraform` so the winget install is reached, or put its directory
earlier on PATH. Until then every command needs the full path to the 1.15.8 binary. Nothing needs
downloading.

Verified with the 1.15.8 binary: `infra/bootstrap` formats, initialises with `-backend=false`, and
**validates clean**.

### D-80 · This repository has only `docs/`
`C:\Developer\Code\OneResi - Copy`

No `app/`, no `infra/`. The code and the Terraform are in `C:\Developer\Code\OneResi`. Open
question 1 in the README.

