import { beforeAll, describe, expect, it } from 'vitest';
import type { OutboxEventInput } from '@grihaone/domain';
import type { Db } from '../client.js';
import { noticesStore } from './notices.js';

/**
 * The Prisma truth for NoticesStore: the board's one ordering rule (pinned, then newest),
 * expiry as the only thing that takes a notice off the feed, and the per-resident fan-out.
 */

interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}
interface Fixtures {
  readonly aUser: (
    db: Db,
    overrides?: { role?: string; status?: string; unitId?: number; email?: string },
  ) => Promise<{ id: number; name: string; email: string }>;
  readonly onDay: (iso: string) => Date;
}

const HARNESS = '../../../../test/helpers/database.js';
const FIXTURES = '../../../../test/helpers/fixtures.js';

const { testDatabase } = (await import(HARNESS)) as Harness;
const { aUser, onDay } = (await import(FIXTURES)) as Fixtures;

let db: Db;

beforeAll(async () => {
  db = (await testDatabase()).db;
});

let eventCounter = 0;
function anEvent(): OutboxEventInput {
  eventCounter += 1;
  return {
    type: 'announcement.published',
    channel: 'IN_APP',
    payload: { announcementId: 1 },
    correlationId: `notices-${eventCounter}`,
  };
}

describe('createAnnouncement', () => {
  it('publishes a notice with one event per active resident, and the author joined', async () => {
    const store = noticesStore(db);
    const author = await aUser(db, { role: 'A', status: 'ACTIVE' });
    const residents = [await aUser(db, { status: 'ACTIVE' }), await aUser(db, { status: 'ACTIVE' })];
    const subscriber = await aUser(db, { status: 'PENDING' });

    const announcement = await store.createAnnouncement(
      {
        authorId: author.id,
        title: 'Water tank cleaning',
        body: 'The overhead tanks are cleaned on Sunday morning; expect a supply pause until 10:00.',
        category: 'MAINTENANCE',
        pinned: false,
        attachmentKey: null,
        expiresAt: null,
        publishedAt: onDay('2026-09-01'),
      },
      (published) =>
        residents.map((resident) => ({
          type: 'announcement.published',
          channel: 'IN_APP',
          payload: { announcementId: published.id, name: resident.name, email: resident.email },
          correlationId: `notice-${published.id}-${resident.id}`,
        })),
    );

    expect(announcement.authorName).toBe(author.name);
    expect(announcement.category).toBe('MAINTENANCE');
    expect(announcement.pinned).toBe(false);
    expect(announcement.expiresAt).toBeNull();
    // Born published: the instant the caller carried is the row's publication instant.
    expect(announcement.publishedAt).toEqual(onDay('2026-09-01'));

    // One outbox row per ACTIVE resident — the pending applicant is not on the board's mail.
    for (const resident of residents) {
      expect(
        await db.outboxEvent.count({ where: { correlationId: `notice-${announcement.id}-${resident.id}` } }),
      ).toBe(1);
    }
    expect(
      await db.outboxEvent.count({ where: { correlationId: `notice-${announcement.id}-${subscriber.id}` } }),
    ).toBe(0);

    const reread = await store.findAnnouncementById(announcement.id);
    expect(reread?.title).toBe('Water tank cleaning');
    expect(reread?.authorName).toBe(author.name);
    expect(await store.findAnnouncementById(announcement.id + 1_000_000)).toBeNull();

    // The roster the fan-out is addressed to.
    const roster = await store.findActiveResidents();
    expect(roster.some((person) => person.id === residents[0]!.id)).toBe(true);
    expect(roster.some((person) => person.id === residents[1]!.id)).toBe(true);
    expect(roster.some((person) => person.id === subscriber.id)).toBe(false);
  });
});

describe('activeAnnouncements', () => {
  it('is pinned first, then newest, and expiry takes a notice off the feed', async () => {
    const store = noticesStore(db);
    const author = await aUser(db, { role: 'A', status: 'ACTIVE' });
    const base = { authorId: author.id, body: 'Body.', category: 'GENERAL', attachmentKey: null } as const;

    const plainNew = await store.createAnnouncement(
      { ...base, title: 'Plain and new', pinned: false, expiresAt: null, publishedAt: onDay('2026-09-10') },
      () => [],
    );
    await store.createAnnouncement(
      { ...base, title: 'Plain and older', pinned: false, expiresAt: null, publishedAt: onDay('2026-09-05') },
      () => [],
    );
    const pinnedOld = await store.createAnnouncement(
      { ...base, title: 'Pinned but older', pinned: true, expiresAt: null, publishedAt: onDay('2026-09-01') },
      () => [],
    );
    const expiresTomorrow = await store.createAnnouncement(
      {
        ...base,
        title: 'Still on the board',
        pinned: false,
        expiresAt: onDay('2026-09-16'),
        publishedAt: onDay('2026-09-09'),
      },
      () => [],
    );
    await store.createAnnouncement(
      {
        ...base,
        title: 'Already expired',
        pinned: true,
        expiresAt: onDay('2026-09-12'),
        publishedAt: onDay('2026-09-08'),
      },
      () => [],
    );

    const feed = await store.activeAnnouncements(onDay('2026-09-15'));
    const titles = feed.map((notice) => notice.title);
    // Pinned outranks newer plain ones; pinned-but-expired is off the board entirely.
    expect(titles).not.toContain('Already expired');
    expect(titles.indexOf('Pinned but older')).toBeLessThan(titles.indexOf('Plain and new'));
    expect(titles.indexOf('Plain and new')).toBeLessThan(titles.indexOf('Still on the board'));
    expect(titles.indexOf('Still on the board')).toBeLessThan(titles.indexOf('Plain and older'));
    expect(feed.some((notice) => notice.id === plainNew.id)).toBe(true);
    expect(feed.some((notice) => notice.id === pinnedOld.id)).toBe(true);
    expect(feed.some((notice) => notice.id === expiresTomorrow.id)).toBe(true);

    // A day later, the expiring notice is gone.
    const nextDay = await store.activeAnnouncements(onDay('2026-09-16'));
    expect(nextDay.some((notice) => notice.id === expiresTomorrow.id)).toBe(false);
    expect(nextDay.some((notice) => notice.id === plainNew.id)).toBe(true);
  });
});

describe('withdrawAnnouncement', () => {
  it('pulls the expiry forward, record intact; an unknown notice is a null', async () => {
    const store = noticesStore(db);
    const author = await aUser(db, { role: 'A', status: 'ACTIVE' });
    const announcement = await store.createAnnouncement(
      {
        authorId: author.id,
        title: 'Event cancelled',
        body: 'The Sunday event will not happen.',
        category: 'EVENT',
        pinned: false,
        attachmentKey: null,
        expiresAt: null,
        publishedAt: onDay('2026-09-18'),
      },
      () => [],
    );

    const withdrawn = await store.withdrawAnnouncement(announcement.id, onDay('2026-09-20'), [anEvent()]);
    expect(withdrawn?.expiresAt).toEqual(onDay('2026-09-20'));
    expect(withdrawn?.title).toBe('Event cancelled');
    // Off the feed the instant it is withdrawn, but the row survives for the audit trail (D-46).
    expect(await store.findAnnouncementById(announcement.id)).not.toBeNull();
    expect((await store.activeAnnouncements(onDay('2026-09-21'))).some((notice) => notice.id === announcement.id)).toBe(
      false,
    );

    const unknown = await store.withdrawAnnouncement(announcement.id + 1_000_000, onDay('2026-09-21'), []);
    expect(unknown).toBeNull();
  });
});
