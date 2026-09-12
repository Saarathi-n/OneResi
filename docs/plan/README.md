# GrihaOne — Rebuild Plan

Read in this order.

| Document | What it settles |
|---|---|
| [01-defect-register.md](01-defect-register.md) | Every architectural mistake found in the current build, with file evidence and the fix |
| [02-architecture.md](02-architecture.md) | Target shape: one API, two front ends, one schema across SQLite and RDS, sync |
| [03-aws-terraform.md](03-aws-terraform.md) | What Terraform provisions, what stays manual, what it costs |
| [04-product-design.md](04-product-design.md) | Brand, motion with weight, progress, pre-filling, and the copy rules |
| [05-testing.md](05-testing.md) | Test suites, including the mail suite and dual-target DB parity |
| [06-roadmap.md](06-roadmap.md) | Phases, gates, and what "done" means at each one |

## What is being built

Two products over one service:

- **Website** — public pages plus the committee/admin desk. Server-rendered, indexable.
- **App (PWA)** — installable, offline-tolerant, phone-shaped. Residents and the gate.

Both talk to one API with one set of contracts. One deployable unit on AWS, so only one
Fargate task ever bills.

## Where things live

| Path | Role |
|---|---|
| `C:\Developer\Learning\...\DA-related` | **Constraint.** The SRS, 29 use cases, ER model, DDL, UML, and the DA1 deck. What was promised to the teacher. Read-only input to this plan. |
| `C:\Developer\Code\GrihaOne` | The current build. Source of the defect register. Becomes reference-only. |
| `C:\Developer\Code\GrihaOne - Copy` | This repo. Where the rebuild lands. Currently holds only `docs/`. |

## Decisions taken in this plan

Each of these is a call I made rather than a question I am parking. Reasoning is in the
document named.

1. **SQLite locally, PostgreSQL on RDS, one schema.** No Postgres server to install, no
   Docker. Money becomes integer paise and enums become validated string unions, which
   removes almost every dialect difference. → 02
2. **One active database chosen at boot, never automatic failover.** Two writable copies
   with silent failover produce divergent data that cannot be merged. Sync is explicit and
   visible. → 02
3. **CloudFront in front of the load balancer for HTTPS.** Gives a valid certificate with no
   domain purchase, which the app requires — the session cookie is `secure`, so the current
   plain-HTTP deployment cannot log anyone in. → 03
4. **Payment stays simulated**, per ADR 0002. What changes is that the resident is never told
   so. The word "simulated" leaves the interface. → 04
5. **No coursework framing in any user-visible surface.** No use-case IDs, no ADR numbers, no
   register numbers, no "seeded" or "demo". Enforced by a build gate, not by discipline. → 04
6. **Real behaviour in every mode.** Mock/offline mode keeps working, but it runs the same
   query layer and the same validation as production instead of a hand-written parallel
   implementation. The current split is the root cause of most defects below. → 02

## Open questions I could not answer from the files

Answer these when convenient; nothing in phase 0 is blocked on them.

1. **This repo has only `docs/`** — no `app/`, no `infra/`. Was `GrihaOne - Copy` meant as a
   clean slate for the rebuild, or did the copy not finish? I am planning for a clean slate
   here with `GrihaOne` as reference. Say if you want it the other way round.
2. **ADR 0003 is still "Proposed · awaiting Ashvin's decision"** and the code has already
   drifted from it in both directions. I am treating it as accepted. Confirm and I will mark
   it so, or amend it.
3. **Five decisions listed as open in `architecture.md`** were silently resolved in code —
   including a hardcoded limit of 6 occupants per unit in one route. I have proposed answers
   in 02; they need a yes.
4. **Route 53 domain, yes or no.** Roughly ₹1,000/year unlocks fully automatic SES
   verification and a real hostname. Without it, mail verification needs you to click links
   in 3–5 inboxes once. Everything else is automated either way. → 03
