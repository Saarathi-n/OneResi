# 02 — Target Architecture

## Shape

One monorepo, one API, two front ends, one schema, two database targets.

```
oneresi/
  apps/
    web/          Next.js — marketing site + committee/admin desk. SSR, indexable.
    app/          Next.js — installable PWA. Residents and the gate. Offline-tolerant.
  packages/
    contracts/    Zod schemas + TypeScript types. The only definition of any payload.
    domain/       Use-case services. No HTTP, no React, no Prisma queries inline.
    db/           Prisma schema, migrations, seed, the two target adapters, sync.
    ui/           Design system: tokens, primitives, motion.
    mail/         Templates, renderer, providers, outbox worker.
  infra/
    bootstrap/    State bucket only. Applied once with local state.
    stack/        Everything else.
  tools/
    dev-console/  Local-only: DB target switch, sync, mail viewer, seed reset.
```

`apps/web` hosts the API routes. `apps/app` is a client of them. Both are built into one
container image and served by one Fargate task, because that task is the only thing that bills.
Route split inside the image: `/` and `/admin/*` from `web`, `/a/*` from `app`, with the service
worker scoped to `/a/`.

Why two apps rather than two route groups in one: the PWA needs a different shell, a different
navigation model, a service worker, and an install manifest, and it must not drag the marketing
site's server-rendered pages into its offline cache. Separate builds keep those concerns from
leaking into each other. They share everything that matters through `packages/*`.

## The layering rule that prevents most of the register

Handlers do four things and nothing else: authenticate, parse with a contract, call one domain
service, map the result to a response. All business rules live in `packages/domain`. All queries
live in `packages/db`.

This is what fixes D-14, D-27, D-39 and D-40 structurally rather than case by case — a rule that
exists in one service cannot be enforced in one route and forgotten in another, and a filter that
lives in a repository function cannot fall through to `{}`.

## Data layer

### One schema, two targets

| | Local | AWS |
|---|---|---|
| Engine | SQLite, file-backed | RDS for PostgreSQL 16 |
| Install needed | none | none |
| Migrations | `prisma migrate` | same migrations, applied by a one-off ECS task |
| Chosen by | `DB_TARGET=local` | `DB_TARGET=cloud` |

Two dialect differences would normally make this painful. Both are removed by decisions that are
better anyway:

- **Money becomes integer paise.** `amount_paise Int`. No `Decimal`, no float, no `parseFloat`,
  no dialect question. One formatter at the presentation edge. Fixes D-50.
- **Enumerations become string unions in `packages/contracts`,** stored as `String`, validated by
  Zod at every boundary, with a `CHECK` constraint added in a migration on both targets. Fixes
  D-16 and D-46, and gives the label maps that fix D-55 for free.

What remains dialect-specific is one thing: the partial unique index on live bookings. Both
engines support partial indexes, with slightly different syntax, so the migration carries a
branch. That is a five-line difference in one file, and 05 has a test that asserts the constraint
actually holds on both.

The provider itself is switched by generating two `schema.prisma` files from one source at build
time — `packages/db/schema.base.prisma` plus a small generator that emits the SQLite and
PostgreSQL variants. Deterministic, checked in CI, and the drift-detection test in 05 fails if the
two ever disagree on anything but the provider line.

> Considered and rejected for now: PGlite, which is real PostgreSQL compiled to WASM and would give
> exact parity with no install. The Prisma driver-adapter path for it needs a spike I would rather
> not put on the critical path. Worth revisiting once the rest is standing — it would let us delete
> the schema generator entirely.

### One active database, chosen at boot

You asked for local as a fallback with data coming from RDS. One thing to flag before building it:
**two writable copies with automatic runtime failover diverge, and the divergence cannot be merged
afterwards.** If the cloud connection drops mid-session and some writes land locally while others
land in the cloud, both copies are now authoritative and neither is correct — invoices raised
twice, bookings that exist in one copy only.

So the shape is:

- `DB_TARGET` picks exactly one database at boot. Never two, never automatic.
- Which one is live is **visible** — a badge in the dev console, and in the admin footer outside
  production.
- If `DB_TARGET=cloud` and the connection fails at boot, the process refuses to start with a clear
  message rather than silently serving local data.
- Sync is an explicit command you run, never a background behaviour.

That gives you what you want — work locally at no cost, push to the cloud when you want it live,
pull the cloud down when you want to reproduce something — without the failure mode.

If you do want live read-through from RDS with a local write buffer, that is a real pattern, but it
needs conflict resolution designed per table and I would not spend that time before the rest of
this plan is done.

### Sync

`packages/db/sync`, driven from the dev console and scriptable:

```
pnpm db:diff        # report only, no writes — run this first
pnpm db:push        # local  -> cloud
pnpm db:pull        # cloud  -> local
```

Export the twelve tables to JSONL in foreign-key order, then upsert by **natural key** into the
target inside one transaction, so a row present on both sides converges instead of duplicating:

| Table | Natural key |
|---|---|
| Block | `name` |
| Unit | `block.name + unit_no` |
| ResidentUser | `email` |
| VisitorPass | `pass_code` |
| Invoice | `unit + period` |
| Payment | `gateway_order_id` |
| Facility | `name` |
| Booking | `facility + date + slot` |
| Announcement | `created_at + title` |
| Complaint, ComplaintUpdate, VisitorLog | surrogate, mapped through a translation table |

Both directions print a row-count table and require confirmation. Afterwards a per-table checksum
is compared and mismatches are listed. That comparison is the acceptance test for phase 6.

Surrogate integer ids will differ between targets. Nothing outside the database may depend on a
specific id value — which is one reason a receipt is addressed by receipt number, not row id.

## Notifications: one pipeline, both environments

The transactional outbox, which is what fixes D-29, D-30, D-31 and D-68 together.

A handler that changes something writes an `outbox_event` row **in the same transaction** as the
change. It never calls SES, never calls SNS, never loops over recipients. It returns.

```
domain service ──tx──> [ state change + outbox_event ] ──> respond
                                    │
                    ┌───────────────┴───────────────┐
              local worker                     AWS worker
        (interval, in-process)         (SQS -> Lambda, fed by SNS)
                    └───────────────┬───────────────┘
                                    ▼
                    mail provider · push · in-app notification row
```

Consequences worth having:

- UC-29 alternative flow 3a — the caller completes even when mail is down — becomes a property of
  the design rather than something each handler remembers.
- The billing run for 200 units is one transaction and one response, not 800 serial round-trips.
- Every message that was ever sent is a database row, which is what the mail test suite asserts
  against (05) and what the admin's mail log reads from. No JSON file on a container disk.
- Retries and a dead letter queue exist on AWS; locally the worker retries with backoff and marks
  a row failed after five attempts.

Live surfaces — the gate approval a resident must answer, and the gate log — get server-sent
events from the same notification rows, plus Web Push on the installed app. That is what makes a
waiting visitor actually appear.

## Authentication

- Access token: JWT in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, **15 minutes**, carrying
  `sub`, `role`, `unitId`, `pwdAt`, `jti`.
- Refresh token: separate `httpOnly` cookie, 14 days, rotated on use, stored hashed.
- Every request resolves the user's current `status` and compares `pwdAt` against
  `password_changed_at`. A disabled account and a reset password both invalidate immediately.
- `middleware.ts` verifies session and role before a route renders; each server route re-checks.
  Client redirects become cosmetic.
- Secret from SSM, minimum 32 bytes, **no fallback** — boot fails without it.
- bcrypt cost 12, one constant, one place.
- Rate limits on login, registration, password reset and gate verification. Fixed-window counters
  in the database locally; the same interface backed by the same table on AWS, which is adequate
  at one task and avoids adding Redis.
- Login compares against a dummy hash when the user does not exist, so response time does not
  reveal whether an account exists.

Fixes D-01, D-05, D-13, D-22, D-23, D-24, D-43.

## Answers to the open decisions

`architecture.md` lists five as unresolved and `register/route.ts` silently decided one of them.
My proposals — say no to any and I will change it before phase 1:

1. **Schema source of truth** — ADR 0003 as written, plus the amendments in D-46. Accept the ADR.
2. **Can an Admin also be a resident?** No. Role is single-valued on the account, and a committee
   member who lives in the society keeps a separate resident login. Keeps `role` an enumeration
   rather than a set, and keeps every authorisation check a comparison. The report notes it as a
   limitation.
3. **Are Admin and Security accounts seeded, or is there a staff-account flow?** Both: seeded for
   the first administrator only, then a staff-invitation flow on the admin desk. A society cannot
   be bootstrapped otherwise, and one seeded account is a smaller special case than a permanent
   inability to add a guard.
4. **Maximum occupants per unit** — 6, which is what the code already assumes, but as a named
   constant in `packages/domain` with a test, not a literal in one route. No document states it, so
   the report records it as an implementation decision.
5. **Is `UNIT.Type` a fixed enumeration?** Yes: `FLAT_1BHK`, `FLAT_2BHK`, `FLAT_3BHK`, `FLAT_4BHK`,
   `VILLA`, `PLOT`, `SHOP`. The submitted DDL has only the four flat types; the current code needs
   `PLOT` and `VILLA` and crashes because they are absent (D-16). Extending the enumeration is the
   honest fix and goes in the errata list.

