import type { Db } from '../client.js';
import type { NoticesStore } from '@oneresi/domain';
import {
  announcementInclude,
  toAnnouncement,
  writeEvents,
} from './shared.js';

/**
 * NoticesStore over Prisma: the notice board and its fan-out. A notice is published the moment
 * it is written — the model has no draft state — and a withdrawal pulls the expiry forward
 * rather than deleting anything, so the record and its audit trail stay (D-46).
 */
export function noticesStore(db: Db): NoticesStore {
  const store: NoticesStore = {
    async activeAnnouncements(now) {
      // Not expired as of `now`: pinned first, then newest — the board's one ordering rule.
      const rows = await db.announcement.findMany({
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        include: announcementInclude,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map(toAnnouncement);
    },

    async findAnnouncementById(id) {
      const row = await db.announcement.findUnique({ where: { id }, include: announcementInclude });
      return row === null ? null : toAnnouncement(row);
    },

    async findActiveResidents() {
      // One outbox row per person, never one message with every address (D-29).
      return db.residentUser.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { id: 'asc' },
      });
    },

    async createAnnouncement(input, eventsFor) {
      return db.$transaction(async (tx) => {
        const created = await tx.announcement.create({
          data: {
            authorId: input.authorId,
            title: input.title,
            body: input.body,
            category: input.category,
            pinned: input.pinned,
            attachmentKey: input.attachmentKey,
            expiresAt: input.expiresAt,
            // Born published: the model has no draft state, so the publication instant the
            // port carries is the row's creation instant.
            createdAt: input.publishedAt,
          },
        });
        const row = await tx.announcement.findUniqueOrThrow({
          where: { id: created.id },
          include: announcementInclude,
        });
        const announcement = toAnnouncement(row);
        await writeEvents(tx, eventsFor(announcement));
        return announcement;
      });
    },

    async withdrawAnnouncement(id, at, events) {
      return db.$transaction(async (tx) => {
        // Expiry pulled to `at`: off every feed, record intact. Null when unknown — a count of
        // zero is the only way an update of an id changes nothing here.
        const applied = await tx.announcement.updateMany({
          where: { id },
          data: { expiresAt: at },
        });
        if (applied.count === 0) return null;

        await writeEvents(tx, events);
        const row = await tx.announcement.findUniqueOrThrow({
          where: { id },
          include: announcementInclude,
        });
        return toAnnouncement(row);
      });
    },
  };

  return store;
}
