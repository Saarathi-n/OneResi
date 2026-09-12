# 06 — Roadmap

Eight phases. Each has a gate that is a command or an observation, not an opinion. Nothing moves on
until its gate passes.

Ordering principle: the security and data-integrity defects come before anything visible, because
every screen built on top of a fail-open filter has to be revisited. The design work comes before
the two shells, because building two front ends without a component library means building
everything twice.

## Phase 0 — Foundations

Monorepo, `packages/contracts`, `packages/db` with the schema generator and both targets, the
migration history including the two missing indexes, the convergent seed, Vitest, Playwright, the
two copy gates, `pnpm verify`, and CI running it on pull requests.

Money becomes integer paise and enumerations become validated string unions here, at the point
where changing them is free.

**Gate** — `pnpm verify` green. `pnpm test:parity` green on both database targets. A migration
applied from empty on both. The seed run twice produces identical checksums.

## Phase 1 — Close the critical defects

The eighteen S1 entries. Authentication rebuilt (15-minute access token, refresh, `pwdAt`, status
resolved per request, cost 12, no secret fallback). `middleware.ts`. Deny-by-default authorisation
with the fail-open expression deleted from all four handlers. The three hardcoded-credential paths
removed. The four unauthenticated endpoints closed. Registration stripped of block and unit
creation and of the applicant-set charge. Payment ownership enforced. Zod at every boundary and one
error mapper. `password_hash` behind `omit` and a view-mapping layer.

**Gate** — the security journeys in 05 pass: no escalation from any unauthenticated page, every
route rejects an anonymous request, the gate account sees nothing outside its remit, no response
body anywhere contains a hash. A short adversarial pass by hand against the running app, written
up.

## Phase 2 — Domain core

`packages/domain`. The mock deleted. Real transactions. State machines for complaint, booking,
pass, visitor log and invoice, so a status change is a permitted transition rather than an assigned
string. The transactional outbox and a local worker. Cryptographic tokens and receipt numbers.
Every rule the interface currently claims but does not enforce — facility hours, slot overlap,
end-after-start, no past-dated passes, occupancy limit as a named constant.

One file per use case in the test suite, all 28.

**Gate** — the domain suite green, including every case named in 05's table. The N+1 email loops
gone: generating invoices for 200 units is one transaction and one response, asserted by query
count.

## Phase 3 — Design system, brand, motion

The mark and icon set. Tokens with dark values. The full component list. Motion tokens,
choreography, reduced-motion. The copy sweep: every use-case identifier, every "simulated", every
"seeded", every demo affordance out of the interface and out of the mail templates.

**Gate** — `pnpm check:copy` and `pnpm check:enums` green with no allow-comments outside `docs/`.
`axe` clean on every route in both themes. The three most common tasks completable by keyboard
only. A side-by-side of before and after, which is also a report figure.

## Phase 4 — The two shells

`apps/web`: real landing page, sign-in, registration as a four-step flow with a resumable draft, and
the committee desk as a dense desktop application. `apps/app`: installable, bottom tabs, sheets,
swipe actions, pull to refresh, offline shell and cached unit data, queued mutations, Web Push, and
the gate kiosk mode. Pre-filling per the table in 04. The receipt route. The notification centre and
server-sent events on the two live surfaces.

**Gate** — Playwright green across three browsers and the mobile viewport. Installable and the shell
loads offline. A visitor logged at the gate appears on the resident's screen with no reload, timed.
Tabs are routes and the back gesture works.

## Phase 5 — AWS, zero-touch

`infra/bootstrap` then `infra/stack`, per 03. Dockerfile and ECR. ALB and CloudFront, so TLS exists
and the session cookie functions. RDS with a managed master password, backups and encryption. The
migrate-and-seed task. Task role. SSM and Secrets Manager. SES with the configuration set and event
destination. SNS, SQS, dead letter queue, notifier Lambda, EventBridge and the overdue Lambda. Alarms
and the $5 budget pointed at a real address. Deploy workflow over OIDC.

**Gate** — from a destroyed state, `pnpm cloud:up` yields an HTTPS URL where you can register, be
approved, receive the approval email, pay an invoice and download the receipt — without touching the
console. `pnpm cloud:down` reports nothing remaining. `pnpm test:mail:live` green.

## Phase 6 — Sync and the dev console

`db:diff`, `db:push`, `db:pull` with natural-key upserts and per-table checksums. The dev console:
which database is live, the switch, sync with a preview, the mail viewer, seed reset.

**Gate** — seed local, push, checksum every table, pull into an empty local, checksum again, and
they match. Confirmed both directions. The live target is visible at a glance and cannot be
misidentified.

## Phase 7 — Report artifacts

Regenerate `grihaone_ddl.sql` from the delivered schema. Complete the errata tables in
`data-model.md`, including everything in D-46. Accept or amend ADR 0003 and record the five decisions
from 02. A new ADR for the local-plus-cloud dual target, and one for the enumeration extension.
Screenshots from the finished product. A traceability table mapping all 28 use cases to their tests.

**Gate** — the submitted ER figure and the running database agree, or every difference is listed with
a reason.

## Sequencing notes

Phases 0 to 2 are the ones that matter and the ones without visible output. It will feel like
nothing is happening. The alternative is building screens on a fail-open authorisation filter and a
mock that accepts values the real database rejects, then rebuilding them.

Phase 5 can start in parallel with 3 once phase 2's gate passes — infrastructure has no dependency
on the design system. Phase 6 needs 5. Phase 7 needs everything.

The two mid-phase checkpoints worth pausing at: after phase 2, the system is correct but plain,
which is the point to confirm the domain decisions from 02 are what you want; after phase 4, it is
a finished product on local data, which is the point to decide how much cloud time to spend.
