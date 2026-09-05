# Task list

Working state. I update this as I go, so if a session is interrupted the next one starts here
rather than re-deriving it. Phases and gates come from [06-roadmap.md](06-roadmap.md).

Legend — `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — Foundations

**Gate** · `pnpm verify` green · `pnpm test:parity` green on both targets · a migration applied
from empty on both · the seed run twice produces identical checksums.

### Workspace
- [x] `.gitignore` corrected — lock file committed, dev store ignored (D-33, D-44)
- [x] root `package.json`, `pnpm-workspace.yaml`, `.npmrc`
- [x] `tsconfig.base.json` + project references
- [ ] `eslint.config.js` with `noUnusedLocals` failing the build (D-74)
- [ ] `scripts/bootstrap.mjs` — one command sets up everything
- [ ] `pnpm install` runs clean

### packages/contracts
- [x] `enums.ts` — 13 enumerations as string unions with display labels (D-16, D-46, D-55)
- [x] `money.ts` — integer paise, formatter, amount in words (D-50)
- [x] `tokens.ts` — crypto codes, hashed tokens, sequenced receipt numbers (D-37, D-38)
- [x] `schemas.ts` — Zod at every boundary (D-39)
- [x] `rules.ts` — named limits and five state machines (D-20, D-72, D-77)
- [ ] unit tests for money, tokens, state machines
- [ ] `errors.ts` — domain error codes and the response mapper (D-39)

### packages/db
- [ ] `schema.base.prisma` — 13 models, integer paise, string enums, FK indexes (D-48)
- [ ] `onDelete: Restrict` on every attribution link (D-47)
- [ ] `Outbox` and `Notification` models (D-29, D-31)
- [ ] `scripts/generate-schemas.mjs` — one base, two providers
- [ ] SQLite migration from empty
- [ ] PostgreSQL migration from empty
- [ ] hand-written partial unique index on live bookings, both dialects (D-18)
- [ ] composite unique on `(unit_id, period)` (D-17)
- [ ] `client.ts` — one client, target chosen at boot, no mock (D-06, D-15)
- [ ] `seed.ts` — convergent, upsert throughout (D-45)
- [ ] `checksum.ts` — per-table checksums for the parity and sync gates

### Test harness
- [ ] `vitest.config.ts` with the dual-target projects
- [ ] fixture factory shared by both targets
- [ ] parity runner `scripts/run-parity.mjs`
- [ ] constraint tests: duplicate invoice rejected, duplicate live booking rejected, slot
      re-bookable after cancel, rollback leaves nothing, `password_hash` excluded
- [ ] schema drift test — the two generated schemas differ only in the datasource block

### Gates
- [ ] `scripts/check-copy.mjs` — no coursework framing under `apps/` (D-51 to D-54)
- [ ] `scripts/check-enums.mjs` — no raw enumeration value in a JSX text node (D-55)
- [ ] CI workflow running `pnpm verify` on pull requests

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
