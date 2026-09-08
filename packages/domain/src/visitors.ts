import * as C from '@oneresi/contracts';
import { ok } from './ports.js';
import type {
  EntryLogView,
  GateDecision,
  PassView,
  Result,
  VisitorsService,
  WaitingVisitorView,
} from './ports.js';
import { errors } from './errors.js';
import type { Clock } from './clock.js';
import type {
  NewVisitorPass,
  OutboxEventInput,
  RateLimiter,
  StoredHome,
  StoredVisitorEntry,
  StoredVisitorLog,
  StoredVisitorPass,
  VisitorStore,
} from './store.js';

/**
 * Visitors: the passes a resident issues, the code the gate checks, and the walk-in queue a
 * household answers.
 *
 * Design consequences, each closing a defect from the register:
 *
 *  - the gate receives a DECISION, never a row: status, date and prior use are all checked
 *    before a pass is admitted, so a cancelled or yesterday's pass can never render as valid
 *    (D-40)
 *  - every code check, including a miss, is counted against the gate's rate window before
 *    anything is looked up — a six-digit code is enumerable, and a miss is the cheapest thing
 *    for an enumerator to try
 *  - a check-in is a guarded ACTIVE -> USED transition with its log row, in one transaction,
 *    and idempotent per pass: a retried check-in must not write a second row (D-40)
 *  - a walk-in notifies every ACTIVE resident of the home, one outbox row per recipient (D-29),
 *    and a guard's override carries its reason and its author (D-21)
 *  - every walk-in decision writes decidedById and decidedAt — the attribution UC-05 was missing
 *    and the previous build never set (D-21)
 *  - a pass may be issued for today or later, at most the lead window ahead (D-72)
 */

/** The payload of one outbox row. Flat scalars, so it survives JSON on either database. */
type MailPayload = Readonly<Record<string, string | number | boolean | null>>;

/** The mail worker renders walk-in email from these events; one row per recipient (D-29). */
function mailEvent(
  type: C.OutboxEventType,
  payload: MailPayload,
  correlationId: string,
): OutboxEventInput {
  return { type, channel: 'EMAIL', payload, correlationId };
}

/**
 * `pass.created` and `visitor.arrived` have no email template by design — they live on the
 * in-app and push surfaces (D-68).
 */
function inAppEvent(
  type: C.OutboxEventType,
  payload: MailPayload,
  correlationId: string,
): OutboxEventInput {
  return { type, channel: 'IN_APP', payload, correlationId };
}

/** The UTC calendar day of `at` — the day a pass is good for, and the day it is stored as (D-72). */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** `2026-09-15` at UTC midnight — how a pass's validOn is stored. */
function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The last day a pass may be issued for (D-72). */
function latestIssueableDay(now: Date): string {
  return utcDay(new Date(now.getTime() + C.MAX_PASS_LEAD_DAYS * 86_400_000));
}

/** "Block A · A-101" — the way a destination is said out loud at a gate. */
function homeLabel(home: StoredHome): string {
  return `${home.blockName} · ${home.label}`;
}

function passView(pass: StoredVisitorPass): PassView {
  return {
    id: pass.id,
    visitorName: pass.visitorName,
    purpose: pass.purpose,
    code: pass.code,
    validOn: pass.validOn,
    status: pass.status,
    arrivedAt: pass.enteredAt,
  };
}

function waitingView(log: StoredVisitorLog): WaitingVisitorView {
  return {
    logId: log.id,
    name: log.walkInName ?? '',
    phone: log.walkInPhone,
    purpose: log.walkInPurpose ?? '',
    since: log.createdAt,
  };
}

function entryView(entry: StoredVisitorEntry): EntryLogView {
  return {
    logId: entry.logId,
    kind: entry.kind,
    visitorName: entry.visitorName,
    purpose: entry.purpose,
    approvalStatus: entry.approvalStatus,
    decidedByName: entry.decidedByName,
    overrideReason: entry.overrideReason,
    enteredAt: entry.enteredAt,
    exitedAt: entry.exitedAt,
    at: entry.createdAt,
  };
}

/** A resident a gate notification is addressed to, as the store hands them over. */
interface Resident {
  readonly id: number;
  readonly name: string;
  readonly email: string;
}

/** "Your visitor is waiting" — one email per ACTIVE resident of the home (D-29). */
function awaitingEvents(
  residents: readonly Resident[],
  visit: {
    readonly visitorName: string;
    readonly phone: string | null;
    readonly purpose: string;
    readonly arrivedAt: Date;
  },
  correlationId: string,
): OutboxEventInput[] {
  return residents.map((resident) =>
    mailEvent(
      'walkin.awaiting_decision',
      {
        name: resident.name,
        email: resident.email,
        recipientName: resident.name,
        visitorName: visit.visitorName,
        purpose: visit.purpose,
        arrivedAt: visit.arrivedAt.toISOString(),
        ...(visit.phone === null ? {} : { visitorPhone: visit.phone }),
      },
      correlationId,
    ),
  );
}

/** The decision, told to the household the same way whether a resident or a guard made it. */
function decidedEvents(
  residents: readonly Resident[],
  decision: 'APPROVED' | 'REJECTED',
  decidedByName: string,
  decidedAt: Date,
  visit: { readonly visitorName: string; readonly purpose: string },
  home: string,
  correlationId: string,
): OutboxEventInput[] {
  return residents.map((resident) =>
    mailEvent(
      'walkin.decided',
      {
        name: resident.name,
        email: resident.email,
        visitorName: visit.visitorName,
        purpose: visit.purpose,
        decision,
        decidedByName,
        decidedAt: decidedAt.toISOString(),
        home,
      },
      correlationId,
    ),
  );
}

/** In-app note to the household that their visitor has walked in (D-68). */
function arrivedEvents(
  residents: readonly Resident[],
  visitorName: string,
  purpose: string,
  correlationId: string,
): OutboxEventInput[] {
  return residents.map((resident) =>
    inAppEvent('visitor.arrived', { name: resident.name, email: resident.email, visitorName, purpose }, correlationId),
  );
}

/** The gate's refusal. A decision with a reason, not an error (D-40). */
function refuse(reason: C.GateRefusalReason): GateDecision {
  return { verdict: 'REFUSE', reason };
}

export interface VisitorsDeps {
  readonly store: VisitorStore;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
}

export function visitorsService(deps: VisitorsDeps): VisitorsService {
  const { store, limiter, clock } = deps;

  return {
    async issuePass(actor, input): Promise<Result<PassView>> {
      if (actor.unitId === null) return errors.forbidden('issue a visitor pass');

      const now = clock.now();
      const today = utcDay(now);
      // A pass valid last week was previously accepted (D-72).
      if (input.validDate < today) {
        return errors.invalid('Choose today or a later date.', 'validDate');
      }
      if (input.validDate > latestIssueableDay(now)) {
        return errors.invalid(
          `A pass can be issued at most ${C.MAX_PASS_LEAD_DAYS} days ahead.`,
          'validDate',
        );
      }

      const correlationId = C.idempotencyKey();
      const birth: Omit<NewVisitorPass, 'code'> = {
        unitId: actor.unitId,
        createdById: actor.userId,
        visitorName: input.visitorName,
        purpose: input.purpose,
        validOn: utcMidnight(input.validDate),
        createdAt: now,
      };
      // Six digits collide eventually. A taken code is not a failure — it is the next attempt.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const pass = await store.createPass(
          { ...birth, code: C.gatePassCode() },
          [
            inAppEvent(
              'pass.created',
              {
                name: actor.name,
                email: actor.email,
                visitorName: input.visitorName,
                purpose: input.purpose,
                validOn: birth.validOn.toISOString(),
              },
              correlationId,
            ),
          ],
        );
        if (pass !== null) return ok(passView(pass));
      }
      return errors.unexpected('The gate code generator could not find a free code.');
    },

    async cancelPass(actor, passId): Promise<Result<PassView>> {
      if (actor.unitId === null) return errors.forbidden('cancel a visitor pass');

      const pass = await store.findPassById(passId);
      // Another household's pass is indistinguishable from a missing one — pass ids are guessable.
      if (pass === null || pass.unitId !== actor.unitId) return errors.notFound('pass');
      if (pass.status !== 'ACTIVE') {
        return errors.stateNotAllowed('Only an active pass can be cancelled.');
      }

      const updated = await store.cancelPass(passId, clock.now(), []);
      if (updated === null) {
        // It changed state between the check and the transition — a rule, not a crash.
        return errors.stateNotAllowed('Only an active pass can be cancelled.');
      }
      return ok(passView(updated));
    },

    async passesForHousehold(actor): Promise<Result<readonly PassView[]>> {
      if (actor.unitId === null) return errors.forbidden('see visitor passes');
      const passes = await store.findPassesForUnit(actor.unitId, {});
      return ok(passes.map(passView));
    },

    async expectedToday(actor): Promise<Result<readonly PassView[]>> {
      if (actor.unitId === null) return errors.forbidden('see expected visitors');
      // USED-today means the visitor already walked in; arrivedAt says so inside the same list.
      const passes = await store.findPassesForUnit(actor.unitId, {
        validOn: utcMidnight(utcDay(clock.now())),
        statuses: ['ACTIVE', 'USED'],
      });
      return ok(passes.map(passView));
    },

    async verifyCode(actor, input, meta): Promise<Result<GateDecision>> {
      if (actor.role !== 'S') return errors.forbidden('work the gate');

      // Counted before anything is looked up, so a miss costs an enumerator exactly what a hit
      // costs (D-40's enumeration note).
      const window = await limiter.consume(`gateVerify:${meta.ip}`, C.RATE_LIMITS.gateVerify);
      if (!window.allowed) return errors.rateLimited(window.retryAfterSeconds);

      const pass = await store.findPassByCode(input.code);
      if (pass === null) return ok(refuse('NOT_FOUND'));
      if (pass.status === 'CANCELLED') return ok(refuse('CANCELLED'));
      if (pass.status === 'EXPIRED') return ok(refuse('EXPIRED'));
      if (pass.status === 'USED') return ok(refuse('ALREADY_USED'));
      if (utcDay(pass.validOn) !== utcDay(clock.now())) return ok(refuse('WRONG_DAY'));

      const home = await store.findHome(pass.unitId);
      // A valid pass whose home has vanished is data corruption, not a gate decision.
      if (home === null) return errors.unexpected(`pass ${pass.id} points at no home`);

      return ok<GateDecision>({
        verdict: 'ADMIT',
        passId: pass.id,
        visitorName: pass.visitorName,
        purpose: pass.purpose,
        destination: homeLabel(home),
        hostName: pass.createdByName,
      });
    },

    async recordEntry(actor, input): Promise<Result<null>> {
      if (actor.role !== 'S') return errors.forbidden('work the gate');

      const pass = await store.findPassById(input.passId);
      if (pass === null) return errors.notFound('pass');
      const today = utcDay(clock.now());

      if (input.action === 'CHECK_IN') {
        if (
          pass.status === 'USED' &&
          pass.enteredAt !== null &&
          pass.exitedAt === null &&
          utcDay(pass.validOn) === today
        ) {
          // The retry of a check-in that already happened is a success, not a second row (D-40).
          return ok(null);
        }
        if (pass.status !== 'ACTIVE') {
          return errors.stateNotAllowed('This pass can no longer be checked in.');
        }
        if (utcDay(pass.validOn) !== today) {
          return errors.stateNotAllowed('This pass is not valid today.');
        }

        const at = clock.now();
        const residents = await store.findResidentsForUnit(pass.unitId);
        const updated = await store.checkInPass(
          { passId: pass.id, at, idempotencyKey: input.idempotencyKey ?? null },
          {
            // The resident pre-authorised this visit the day they issued the pass.
            passId: pass.id,
            unitId: pass.unitId,
            walkInName: null,
            walkInPhone: null,
            walkInPurpose: null,
            approvalStatus: 'NOT_REQUIRED',
            decidedById: null,
            decidedAt: null,
            overrideReason: null,
            enteredAt: at,
            createdAt: at,
          },
          arrivedEvents(residents, pass.visitorName, pass.purpose, input.idempotencyKey ?? C.idempotencyKey()),
        );
        if (updated === null) {
          return errors.stateNotAllowed('This pass can no longer be checked in.');
        }
        return ok(null);
      }

      // CHECK_OUT
      if (pass.enteredAt === null) {
        return errors.stateNotAllowed('There is no open entry for this pass.');
      }
      if (pass.exitedAt !== null) {
        return errors.alreadyDone('This visitor has already checked out.');
      }
      const log = await store.checkOutPass(pass.id, clock.now());
      if (log === null) {
        return errors.stateNotAllowed('There is no open entry for this pass.');
      }
      return ok(null);
    },

    async logWalkIn(actor, input): Promise<Result<{ logId: number }>> {
      if (actor.role !== 'S') return errors.forbidden('log a walk-in');

      const home = await store.findHome(input.unitId);
      // A retired home receives no visitors, and to the guard it simply does not exist.
      if (home === null || !home.active) return errors.notFound('unit');

      const now = clock.now();
      const residents = await store.findResidentsForUnit(input.unitId);
      const correlationId = C.idempotencyKey();

      if (input.guardOverride !== undefined) {
        // The guard admitted without waiting. The exception names itself and its author (D-21),
        // and the household still hears the decision the same way.
        const log = await store.createWalkInLog(
          {
            passId: null,
            unitId: input.unitId,
            walkInName: input.visitorName,
            walkInPhone: input.phone ?? null,
            walkInPurpose: input.purpose,
            approvalStatus: 'APPROVED',
            decidedById: actor.userId,
            decidedAt: now,
            overrideReason: input.guardOverride.reason,
            enteredAt: null,
            createdAt: now,
          },
          decidedEvents(
            residents,
            'APPROVED',
            actor.name,
            now,
            { visitorName: input.visitorName, purpose: input.purpose },
            homeLabel(home),
            correlationId,
          ),
        );
        return ok({ logId: log.id });
      }

      // The visitor waits; the household answers (UC-05).
      const log = await store.createWalkInLog(
        {
          passId: null,
          unitId: input.unitId,
          walkInName: input.visitorName,
          walkInPhone: input.phone ?? null,
          walkInPurpose: input.purpose,
          approvalStatus: 'PENDING',
          decidedById: null,
          decidedAt: null,
          overrideReason: null,
          enteredAt: null,
          createdAt: now,
        },
        awaitingEvents(
          residents,
          {
            visitorName: input.visitorName,
            phone: input.phone ?? null,
            purpose: input.purpose,
            arrivedAt: now,
          },
          correlationId,
        ),
      );
      return ok({ logId: log.id });
    },

    async decideWalkIn(actor, input): Promise<Result<null>> {
      if (actor.unitId === null) return errors.forbidden('answer for a home');

      const log = await store.findLogById(input.logId);
      // Another household's visit is indistinguishable from a missing one.
      if (log === null || log.unitId !== actor.unitId) return errors.notFound('visit');
      if (log.approvalStatus !== 'PENDING') {
        return errors.alreadyDone('This visit has already been decided.');
      }

      const home = await store.findHome(actor.unitId);
      if (home === null) return errors.unexpected(`unit ${actor.unitId} points at no block`);

      const residents = await store.findResidentsForUnit(actor.unitId);
      const at = clock.now();
      const approvalStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await store.decideWalkInLog(
        {
          logId: log.id,
          approvalStatus,
          decidedById: actor.userId,
          decidedAt: at,
        },
        decidedEvents(
          residents,
          approvalStatus,
          actor.name,
          at,
          { visitorName: log.walkInName ?? '', purpose: log.walkInPurpose ?? '' },
          homeLabel(home),
          C.idempotencyKey(),
        ),
      );
      if (updated === null) {
        // Decided between the check and the transition — same answer, same words.
        return errors.alreadyDone('This visit has already been decided.');
      }
      return ok(null);
    },

    async waitingForHousehold(actor): Promise<Result<readonly WaitingVisitorView[]>> {
      if (actor.unitId === null) return errors.forbidden('see waiting visitors');
      const logs = await store.findPendingWalkIns(actor.unitId);
      return ok(logs.map(waitingView));
    },

    async entriesForHousehold(actor): Promise<Result<readonly EntryLogView[]>> {
      if (actor.unitId === null) return errors.forbidden('see the visitor log');
      // The feed reads the recent past, not the whole history: a month of gate traffic is more
      // than any resident scrolls, and the limit keeps the payload phone-sized.
      const entries = await store.findLogsForUnit(actor.unitId, 30);
      return ok(entries.map(entryView));
    },
  };
}
