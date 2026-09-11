import * as C from '@oneresi/contracts';
import { errors } from './errors.js';
import type { Clock } from './clock.js';
import { ok, type Result, type ComplaintsService, type ComplaintView } from './ports.js';
import type { ComplaintStore, OutboxEventInput, StoredComplaint } from './store.js';

/**
 * Complaints. The state machine is the contract's, not a ternary in a handler: `resolvedAt` is
 * set on entering RESOLVED and survives every later update — the previous build nulled it on any
 * non-resolution note, destroying the seven-day reopen window the moment the committee wrote a
 * follow-up (D-20). The resident's reopen is measured from `resolvedAt`, never from `updatedAt`.
 *
 * Views are scoped: a household sees its own complaint's history in full, the committee sees the
 * society's, and another household's complaint reads as nonexistent.
 */

type MailPayload = Readonly<Record<string, string | number | boolean | null>>;

function mailEvent(
  type: C.OutboxEventType,
  payload: MailPayload,
  correlationId: string,
): OutboxEventInput {
  return { type, channel: 'EMAIL', payload, correlationId };
}

/**
 * The push twin of an in-app event: the same flat payload on the channel the push worker drains.
 * The two channels have their own rows and their own workers, so the lock-screen alert and the
 * in-feed acknowledgement are written together and never suppress each other (D-29's shape).
 */
function inAppAndPushEvents(
  payload: MailPayload,
  type: C.OutboxEventType,
  correlationId: string,
): OutboxEventInput[] {
  return [
    { type, channel: 'IN_APP', payload, correlationId },
    { type, channel: 'PUSH', payload, correlationId },
  ];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The deadline the resident reads on a resolved complaint. */
function reopenableUntil(complaint: StoredComplaint): Date | null {
  if (complaint.status !== 'RESOLVED' || complaint.resolvedAt === null) return null;
  return new Date(
    complaint.resolvedAt.getTime() + C.COMPLAINT_REOPEN_WINDOW_DAYS * MS_PER_DAY,
  );
}

function complaintView(complaint: StoredComplaint): ComplaintView {
  return {
    id: complaint.id,
    category: complaint.category,
    priority: complaint.priority,
    description: complaint.description,
    status: complaint.status,
    raisedAt: complaint.raisedAt,
    resolvedAt: complaint.resolvedAt,
    reopenableUntil: reopenableUntil(complaint),
    updates: complaint.updates.map((update) => ({
      at: update.createdAt,
      by: update.updatedByName,
      statusAfter: update.statusAfter,
      note: update.note,
    })),
  };
}

export interface ComplaintsDeps {
  readonly store: ComplaintStore;
  readonly clock: Clock;
}

export function complaintsService(deps: ComplaintsDeps): ComplaintsService {
  const { store, clock } = deps;

  return {
    async raise(actor, input): Promise<Result<ComplaintView>> {
      if (actor.unitId === null) return errors.forbidden('raise a complaint');

      const residents = await store.findResidentsForUnit(actor.unitId);
      const correlationId = C.idempotencyKey();
      const complaint = await store.createComplaint(
        {
          unitId: actor.unitId,
          category: input.category,
          priority: input.priority,
          description: input.description,
          // Object keys from a presigned upload. Opaque strings; the service never opens one.
          photoKeys: input.photoKeys,
          raisedAt: clock.now(),
        },
        (created) =>
          // No email template exists for a raised complaint; the acknowledgement is in-app and
          // push — the surfaces a resident actually watches.
          residents.flatMap((resident) =>
            inAppAndPushEvents(
              {
                name: resident.name,
                email: resident.email,
                complaintId: created.id,
                category: input.category,
              },
              'complaint.raised',
              correlationId,
            ),
          ),
      );
      return ok(complaintView(complaint));
    },

    async forHousehold(actor): Promise<Result<readonly ComplaintView[]>> {
      if (actor.unitId === null) return errors.forbidden('view complaints');
      const complaints = await store.findComplaintsForUnit(actor.unitId);
      return ok(complaints.map(complaintView));
    },

    async forSociety(actor, filter): Promise<Result<readonly ComplaintView[]>> {
      if (actor.role !== 'A') return errors.forbidden('view the complaint desk');
      const complaints = await store.findComplaintsForSociety(
        filter?.status === undefined ? {} : { status: filter.status },
      );
      return ok(complaints.map(complaintView));
    },

    async update(actor, input): Promise<Result<ComplaintView>> {
      if (actor.role !== 'A') return errors.forbidden('update a complaint');

      const complaint = await store.findComplaintById(input.complaintId);
      if (complaint === null) return errors.notFound('complaint');

      if (!C.COMPLAINT_TRANSITIONS[complaint.status].includes(input.status)) {
        return errors.stateNotAllowed(
          'That change is not allowed while the complaint is where it is now.',
        );
      }

      const now = clock.now();
      const correlationId = C.idempotencyKey();
      const residents = await store.findResidentsForUnit(complaint.unitId);
      const events = residents.map((resident) =>
        mailEvent(
          'complaint.updated',
          {
            name: resident.name,
            email: resident.email,
            recipientName: resident.name,
            complaintId: complaint.id,
            category: complaint.category,
            status: input.status,
            note: input.note,
            updatedByName: actor.name,
            updatedAt: now.toISOString(),
            // Present exactly when the household can still reopen it (D-20).
            ...(input.status === 'RESOLVED'
              ? {
                  reopenableUntil: new Date(
                    now.getTime() + C.COMPLAINT_REOPEN_WINDOW_DAYS * MS_PER_DAY,
                  ).toISOString(),
                }
              : {}),
          },
          correlationId,
        ),
      );

      const updated = await store.applyComplaintUpdate(
        {
          complaintId: complaint.id,
          statusAfter: input.status,
          updatedById: actor.userId,
          note: input.note,
          at: now,
        },
        events,
      );
      if (updated === null) {
        return errors.conflict('This complaint changed while it was being updated.');
      }
      return ok(complaintView(updated));
    },

    async reopen(actor, input): Promise<Result<ComplaintView>> {
      if (actor.unitId === null) return errors.forbidden('reopen a complaint');

      const complaint = await store.findComplaintById(input.complaintId);
      // Another household's complaint reads as nonexistent.
      if (complaint === null || complaint.unitId !== actor.unitId) {
        return errors.notFound('complaint');
      }
      if (complaint.status !== 'RESOLVED' || complaint.resolvedAt === null) {
        return errors.stateNotAllowed('Only a resolved complaint can be reopened.');
      }
      // The window is measured from resolution, and resolution survives every later
      // update — which is the whole point of keeping the timestamp honest (D-20).
      const deadline = reopenableUntil(complaint);
      if (deadline === null || clock.now() > deadline) {
        return errors.windowClosed(
          `A complaint can be reopened within ${C.COMPLAINT_REOPEN_WINDOW_DAYS} days of it being fixed.`,
        );
      }

      const now = clock.now();
      const correlationId = C.idempotencyKey();
      const residents = await store.findResidentsForUnit(complaint.unitId);
      const reopened = await store.reopenComplaint(
        {
          complaintId: complaint.id,
          reopenedById: actor.userId,
          reason: input.reason,
          at: now,
        },
        residents.flatMap((resident) =>
          inAppAndPushEvents(
            {
              name: resident.name,
              email: resident.email,
              complaintId: complaint.id,
              category: complaint.category,
              reason: input.reason,
            },
            'complaint.reopened',
            correlationId,
          ),
        ),
      );
      if (reopened === null) {
        return errors.conflict('This complaint changed while it was being reopened.');
      }
      return ok(complaintView(reopened));
    },
  };
}
