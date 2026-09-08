import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../client.js';
import { notificationsStore } from './notifications.js';

/**
 * The Prisma truth for NotificationsStore: the worker's fan-in read model. Rows arrive from the
 * outbox relay, never from a service, so the only mutations are the worker's insert and the
 * resident's mark-read — scoped to the resident, counting only what changed.
 */

interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}
interface Fixtures {
  readonly aUser: (
    db: Db,
    overrides?: { role?: string; status?: string; unitId?: number; email?: string },
  ) => Promise<{ id: number; name: string }>;
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

describe('createNotifications and notificationsForUser', () => {
  it('fans in one row per person and reads them back newest first', async () => {
    const store = notificationsStore(db);
    const resident = await aUser(db, { status: 'ACTIVE' });
    const other = await aUser(db, { status: 'ACTIVE' });

    await store.createNotifications([
      {
        userId: resident.id,
        type: 'invoice.raised',
        title: 'Your September bill is ready',
        body: 'Rs 3,500.00 is due on 5 October.',
        href: '/billing',
        createdAt: onDay('2026-09-01'),
      },
      {
        userId: resident.id,
        type: 'complaint.updated',
        title: 'Your complaint is being fixed',
        body: 'The committee marked your report as in progress.',
        href: '/complaints',
        createdAt: onDay('2026-09-03'),
      },
      {
        userId: other.id,
        type: 'announcement.published',
        title: 'Water tank cleaning',
        body: 'Sunday morning, supply pauses until 10:00.',
        href: null,
        createdAt: onDay('2026-09-04'),
      },
    ]);

    const feed = await store.notificationsForUser(resident.id);
    expect(feed.map((row) => row.type)).toEqual(['complaint.updated', 'invoice.raised']);
    expect(feed.every((row) => row.readAt === null)).toBe(true);
    expect(feed[0]!.href).toBe('/complaints');
    expect(feed[1]!.href).toBe('/billing');
    // The other resident's row is not on this feed.
    expect(await store.notificationsForUser(resident.id + 1_000_000)).toHaveLength(0);

    // An empty fan-in writes nothing and breaks nothing.
    await store.createNotifications([]);
    expect(await db.notification.count({ where: { userId: resident.id } })).toBe(2);
  });
});

describe('markNotificationsRead', () => {
  it('is scoped to the caller and counts only the rows it changed', async () => {
    const store = notificationsStore(db);
    const resident = await aUser(db, { status: 'ACTIVE' });
    const neighbour = await aUser(db, { status: 'ACTIVE' });
    await store.createNotifications([
      {
        userId: resident.id,
        type: 'invoice.raised',
        title: 'One',
        body: 'Body.',
        href: null,
        createdAt: onDay('2026-09-10'),
      },
      {
        userId: resident.id,
        type: 'payment.received',
        title: 'Two',
        body: 'Body.',
        href: null,
        createdAt: onDay('2026-09-11'),
      },
      {
        userId: neighbour.id,
        type: 'invoice.raised',
        title: 'Three',
        body: 'Body.',
        href: null,
        createdAt: onDay('2026-09-12'),
      },
    ]);
    const mine = await store.notificationsForUser(resident.id);
    const theirs = await store.notificationsForUser(neighbour.id);

    // A foreign id in the list marks nothing: the call cannot reach across households.
    const changed = await store.markNotificationsRead(
      resident.id,
      [mine[0]!.id, mine[1]!.id, theirs[0]!.id],
      onDay('2026-09-13'),
    );
    expect(changed).toBe(2);
    expect((await store.notificationsForUser(resident.id)).every((row) => row.readAt !== null)).toBe(true);
    expect((await store.notificationsForUser(neighbour.id))[0]!.readAt).toBeNull();

    // Marking an already-read row again is a no-op, not an error — and not recounted.
    const again = await store.markNotificationsRead(resident.id, [mine[0]!.id], onDay('2026-09-14'));
    expect(again).toBe(0);
    expect((await store.notificationsForUser(resident.id))[1]!.readAt).toEqual(onDay('2026-09-13'));

    // And an empty list is a clean zero.
    expect(await store.markNotificationsRead(resident.id, [], onDay('2026-09-15'))).toBe(0);
  });
});
