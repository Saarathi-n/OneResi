import { describe, expect, it } from 'vitest';
import * as C from '@grihaone/contracts';
import { noticesService } from './notices.js';
import type { Clock } from './clock.js';
import type { NoticesStore, StoredAnnouncement } from './store.js';
import type { Actor } from './ports.js';

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

describe('Notices Expiration IST calculation (Bug 22)', () => {
  const adminActor: Actor = {
    userId: 1,
    name: 'Secretary',
    role: 'A',
    unitId: null,
    email: 'sec@society.in',
  };

  it('sets expiresAt to the end of the day in IST (18:30 UTC)', async () => {
    // 2026-09-20 at 10:00 AM IST is 2026-09-20T04:30:00.000Z
    const clock = new FixedClock(new Date('2026-09-20T04:30:00.000Z'));
    let storedInputExpiresAt: Date | null = null;

    const fakeStore: NoticesStore = {
      findActiveResidents: () => Promise.resolve([{ id: 10, name: 'Resident Ten', email: 'ten@society.in' }]),
      findAnnouncementById: () => Promise.resolve(null),
      activeAnnouncements: () => Promise.resolve([]),
      createAnnouncement: (input) => {
        storedInputExpiresAt = input.expiresAt;
        const announcement: StoredAnnouncement = {
          id: 1,
          authorId: input.authorId,
          authorName: 'Secretary',
          title: input.title,
          body: input.body,
          category: input.category,
          pinned: input.pinned,
          attachmentKey: input.attachmentKey,
          expiresAt: input.expiresAt,
          publishedAt: input.publishedAt,
        };
        return Promise.resolve(announcement);
      },
      withdrawAnnouncement: () => Promise.resolve(null),
    };

    const service = noticesService({ store: fakeStore, clock });

    const result = await service.publish(
      adminActor,
      C.PublishAnnouncementInput.parse({
        title: 'Water Tank Cleaning Today',
        body: 'Water supply will be interrupted between 2pm and 4pm.',
        category: 'MAINTENANCE',
        pinned: false,
        expiresOn: '2026-09-20',
      }),
    );

    expect(result.ok).toBe(true);
    // End of day in IST for 2026-09-20 is 2026-09-20T18:30:00.000Z
    expect(storedInputExpiresAt).not.toBeNull();
    expect((storedInputExpiresAt as unknown as Date).toISOString()).toBe('2026-09-20T18:30:00.000Z');
    // Ensure that at the time of creation (04:30 UTC), expiresAt (18:30 UTC) is 14 hours in the future
    expect((storedInputExpiresAt as unknown as Date).getTime()).toBeGreaterThan(clock.now().getTime());
  });
});
