# Task list

Working state. I update this as I go, so if a session is interrupted the next one starts here
rather than re-deriving it. Phases and gates come from [06-roadmap.md](06-roadmap.md).

Legend — `[ ]` not started · `[~]` written but never compiled or run · `[x]` verified · `[!]` blocked

> **Paused 2026-09-05.** Read [RESUME.md](RESUME.md) first. Four parallel streams were stopped
> mid-flight; everything they wrote is marked `[~]` — on disk, never typechecked. Integration is
> the first job, not new code.

---

## Phase 0 — Foundations

**Gate** · `pnpm verify` green · `pnpm test:parity` green on both targets · a migration applied
from empty on both · the seed run twice produces identical checksums.

### Workspace
- [x] `.gitignore` corrected — lock file committed, dev store ignored (D-33, D-44)
- [x] root `package.json`, `pnpm-workspace.yaml`, `.gitattributes`
- [x] `tsconfig.base.json` + project references
- [x] `pnpm install` runs clean (needed `allowBuilds` for Prisma and esbuild on pnpm 11)
- [~] `eslint.config.js` with unused-locals failing the build (D-74)
- [~] `scripts/bootstrap.mjs` — one command sets up everything

### packages/contracts
- [x] `enums.ts` — 13 enumerations as string unions with display labels (D-16, D-46, D-55)
- [x] `money.ts` — integer paise, formatter, amount in words (D-50)
- [x] `tokens.ts` — crypto codes, hashed tokens, sequenced receipt numbers (D-37, D-38)
- [x] `schemas.ts` — Zod at every boundary (D-39)
- [x] `rules.ts` — named limits and five state machines (D-20, D-72, D-77)
- [~] unit tests for money, tokens, state machines
- [ ] `errors.ts` — moved to `packages/domain`, done there

### packages/db
- [x] `schema.base.prisma` — 12 domain + 7 infrastructure models, integer paise, string enums, FK indexes (D-48)
- [x] `onDelete: Restrict` on every attribution link (D-47)
- [x] `OutboxEvent`, `MailMessage`, `Notification` models (D-29, D-31)
- [x] `scripts/generate-schemas.mjs` — one base, two providers, digest asserted identical
- [x] SQLite migration from empty, applied
- [x] PostgreSQL migration from empty, generated (not applied — no server here)
- [x] hand-written partial unique index on live bookings, both dialects (D-18)
- [x] composite unique on `(unitId, period)` (D-17)
- [x] `client.ts` — one client, target chosen at boot, connectivity checked, no mock (D-06, D-15)
- [x] `seed.ts` — convergent, verified identical over three runs (D-45)
- [x] `tables.ts` — write order and natural keys for checksum and sync
- [ ] `checksum.ts` — per-table checksums for the parity and sync gates

### packages/domain
- [x] `ports.ts` — every use case as a typed signature, plus view types
- [x] `errors.ts` — named failures, one status mapping (D-39)
- [ ] auth service — 15-min access token, rotated refresh, `passwordChangedAt`, rate limits
- [ ] every other service

### Streams stopped mid-flight — on disk, never compiled
- [~] `packages/ui` — 41 files: tokens, motion, brand mark, ~25 components
- [~] `packages/mail` — 33 files: 13 templates, console + SES providers, worker, `expectMail()`
- [~] `infra/` — bootstrap, 18-file stack, Dockerfile, 2 Lambdas
- [~] `test/` + `scripts/` — 6 test files, copy gate, enum gate, parity runner, bootstrap

### Gates
- [~] `scripts/check-copy.mjs` — no coursework framing under `apps/` (D-51 to D-54)
- [~] `scripts/check-enums.mjs` — no raw enumeration value in a JSX text node (D-55)
- [ ] CI workflow running `pnpm verify` on pull requests
- [ ] **Phase 0 gate NOT met** — nothing in the four streams has been typechecked or run

---

## Later phases

Not started. Expanded when the phase before it passes its gate.

- [ ] **Phase 1** — close the 18 critical defects
- [ ] **Phase 2** — domain services, real transactions, outbox
- [ ] **Phase 3** — design system, brand mark, motion
- [ ] **Phase 4** — website and installable app
- [ ] **Phase 5** — Terraform, zero-touch
- [ ] **Phase 6** — sync and the dev console
- [ ] **Phase 7** — report artefacts

---

## Decisions still needed from Ashvin

Not blocking phase 0. Listed in [README.md](README.md).

1. [ ] Is this repo the clean slate? (assuming yes)
2. [ ] Accept ADR 0003 with the D-46 amendments? (assuming yes)
3. [ ] The five decisions answered in [02-architecture.md](02-architecture.md)?
4. [ ] Route 53 domain, yes or no?
