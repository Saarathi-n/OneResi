import * as C from '@grihaone/contracts';
import { errors } from './errors.js';
import type { Clock } from './clock.js';
import { ok, type Result, type NoticesService, type NoticeView } from './ports.js';
import type { NoticesStore, OutboxEventInput, StoredAnnouncement } from './store.js';

/**
 * Notices. The submitted model has no draft state — a notice is published the moment the
 * committee writes it — so "draft -> published" is one write, and the mail fan-out happens inside
 * it: one outbox row per ACTIVE resident, never one message addressed to everybody (D-29). A
 * withdrawal does not delete anything; it pulls the expiry to now, which takes the notice off
 * every feed while the record and its audit trail stay (D-46).
 */

type MailPayload = Readonly<Record<string, string | number | boolean | null>>;

function mailEvent(
  type: C.OutboxEventType,
  payload: MailPayload,
  correlationId: string,
): OutboxEventInput {
  return { type, channel: 'EMAIL', payload, correlationId };
}

/** A calendar day (`YYYY-MM-DD`) as the UTC midnight it is stored at. */
function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function noticeView(announcement: StoredAnnouncement): NoticeView {
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    category: announcement.category,
    pinned: announcement.pinned,
    publishedAt: announcement.publishedAt,
    authorName: announcement.authorName,
  };
}

export interface NoticesDeps {
  readonly store: NoticesStore;
  readonly clock: Clock;
}

export function noticesService(deps: NoticesDeps): NoticesService {
  const { store, clock } = deps;

  return {
    async feed(_actor): Promise<Result<readonly NoticeView[]>> {
      // Every authenticated member reads the same board; ordering is the store's one rule
      // (pinned first, then newest, D-46).
      const announcements = await store.activeAnnouncements(clock.now());
      return ok(announcements.map(noticeView));
    },

    async publish(actor, input): Promise<Result<NoticeView>> {
      if (actor.role !== 'A') return errors.forbidden('publish a notice');

      if (
        input.expiresOn !== undefined &&
        input.expiresOn < clock.now().toISOString().slice(0, 10)
      ) {
        return errors.invalid('The expiry date cannot be in the past.', 'expiresOn');
      }

      const now = clock.now();
      const residents = await store.findActiveResidents();
      const correlationId = C.idempotencyKey();
      const announcement = await store.createAnnouncement(
        {
          authorId: actor.userId,
          title: input.title,
          body: input.body,
          category: input.category,
          pinned: input.pinned,
          // An object key from a presigned upload. Opaque; the service never opens one.
          attachmentKey: input.attachmentKey ?? null,
          expiresAt:
            input.expiresOn === undefined ? null : utcMidnight(input.expiresOn),
          publishedAt: now,
        },
        (created) =>
          residents.map((resident) =>
            mailEvent(
              'announcement.published',
              {
                name: resident.name,
                email: resident.email,
                announcementId: created.id,
                title: created.title,
                body: created.body,
                category: created.category,
                authorName: created.authorName,
                publishedAt: created.publishedAt.toISOString(),
                ...(input.expiresOn === undefined ? {} : { expiresOn: input.expiresOn }),
              },
              correlationId,
            ),
          ),
      );
      return ok(noticeView(announcement));
    },

    async withdraw(actor, noticeId): Promise<Result<null>> {
      if (actor.role !== 'A') return errors.forbidden('withdraw a notice');

      const announcement = await store.findAnnouncementById(noticeId);
      if (announcement === null) return errors.notFound('notice');
      const now = clock.now();
      if (announcement.expiresAt !== null && announcement.expiresAt <= now) {
        // Already off every feed; withdrawing again changes nothing.
        return errors.alreadyDone('This notice is already off the feed.');
      }

      const withdrawn = await store.withdrawAnnouncement(noticeId, now, []);
      if (withdrawn === null) return errors.conflict('This notice changed while it was being withdrawn.');
      return ok(null);
    },
  };
}
