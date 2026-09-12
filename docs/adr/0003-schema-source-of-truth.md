# ADR 0003 — The schema source of truth is the union of the ER model and the DDL

**Status** Proposed · 2026-09-02 · awaiting Ashvin's decision

## Context

Two submitted artifacts describe the data model and they disagree.

`project/GrihaOne/er.mmd` carries the fuller column set, including `password_hash`, the
`created_at` and `resolved_at` timestamps, and the `created_by`, `updated_by`, `generated_by` and
`approved_by` foreign keys.

`project/GrihaOne/grihaone_ddl.sql` carries the precise constraints — primary keys, unique
constraints and check constraints — but drops ten columns the ER model has. It was written to
import into Oracle SQL Developer Data Modeler and render clean connector lines, and the omissions
follow from that purpose rather than from a design decision.

Taken literally, the DDL cannot support the system: `RESIDENT_USER` has no password column, so
UC-01 step 3 has nothing to verify a credential against.

## Decision

Build the Prisma schema from the union: every column present in `er.mmd`, every constraint present
in the DDL, plus a small set of additions each traceable to a specific use case. The additions are
listed in full in [../data-model.md](../data-model.md) and comprise:

- `REJECTED` on `RESIDENT_USER.status`, required by UC-19's postcondition
- `PENDING` and `REJECTED` on `BOOKING.status`, required by UC-11 and UC-23
- `approval_status`, `decided_by` and `decided_at` on `VISITOR_LOG`, required by UC-05
- `active` on `BLOCK` and `UNIT`, required by UC-18's deactivate action
- `password_changed_at`, `reset_token_hash` and `reset_expires_at` on `RESIDENT_USER`, required by
  UC-03's single-use, time-limited reset and its session-invalidation postcondition
- `entry_time` on `VISITOR_LOG` relaxed to nullable, because UC-16 creates the row before entry
  occurs
- `UQ_BOOKING_SLOT` replaced by a partial unique index limited to `PENDING` and `CONFIRMED`
  bookings, because the constraint as written makes UC-12's slot release impossible

## Alternative rejected

Treating the submitted DDL as frozen and working around it. That would mean storing password
hashes somewhere outside the user table, giving up the identity attribution UC-20 and UC-23
explicitly require, and leaving a cancelled booking blocking its slot forever. The result would be
code that contradicts its own documented behaviour, which is harder to defend at review than a
documented correction.

## Consequences

- The entity count stays at twelve and every relationship in the submitted ER diagram is unchanged,
  so the use case, class, sequence and activity models remain valid.
- `grihaone_ddl.sql` is regenerated from the reconciled model before the final report, and the delta
  tables in `data-model.md` become the errata list explaining the difference.
- One migration is hand-edited rather than generated, because Prisma cannot express a filtered
  unique index in `schema.prisma`.
