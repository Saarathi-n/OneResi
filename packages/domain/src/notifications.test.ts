import { describe, expect, it } from 'vitest';
import { notificationsService, pushNotification } from './notifications.js';
import type { Clock } from './clock.js';
import type { PushRequest, PushResult, PushTransport } from './ports.js';
import type {
  NewNotification,
  NewPushSubscription,
  NotificationsStore,
  OutboxEventInput,
  StoredNotification,
  StoredPushSubscription,
} from './store.js';

/**
 * The notifications service, exercised against fakes that implement the store seam — the same
 * pattern `accounts.test.ts` keeps. The wording lives in this service, once, and this file holds
 * it to its contract: what a lock screen says, which events it says nothing about, and what a
 * dispatch does to a subscription the push service has declared dead.
 *
 * The transport is a fake that records every `PushRequest`, so the exact title, body and path a
 * person would read are asserted — not just that "a send happened". `path` is a path, never a
 * URL (D-22): the origin is the click handler's business, and a wording that baked one in would
 * break the PWA in dev the moment it looked right in production.
 */

// ---------------------------------------------------------------- fakes

/** Time under the test's control. `now()` always returns the same instant until it is moved. */
class MutableClock implements Clock {
  #now: Date;
  constructor(iso: string) {
    this.#now = new Date(iso);
  }
  now(): Date {
    return this.#now;
  }
}

interface NotificationRow {
  id: number;
  userId: number;
  type: OutboxEventInput['type'];
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * The store seam in memory. Subscription rows are replaced rather than mutated (they are readonly
 * snapshots of the store's rows, as the seam hands them out), so no caller ever holds a live
 * reference — the same discipline the Prisma store keeps by returning fresh reads.
 */
class MemoryStore implements NotificationsStore {
  readonly notifications: NotificationRow[] = [];
  readonly subscriptions: StoredPushSubscription[] = [];
  #nextNotificationId = 1;

  notificationsForUser(userId: number): Promise<readonly StoredNotification[]> {
    return Promise.resolve(
      [...this.notifications].filter((row) => row.userId === userId).reverse(),
    );
  }

  markNotificationsRead(userId: number, ids: readonly number[], readAt: Date): Promise<number> {
    let changed = 0;
    for (const row of this.notifications) {
      if (row.userId !== userId || !ids.includes(row.id) || row.readAt !== null) continue;
      row.readAt = readAt;
      changed += 1;
    }
    return Promise.resolve(changed);
  }

  createNotifications(rows: readonly NewNotification[]): Promise<void> {
    for (const row of rows) {
      this.notifications.push({ ...row, id: this.#nextNotificationId++, readAt: null });
    }
    return Promise.resolve();
  }

  upsertSubscription(input: NewPushSubscription): Promise<StoredPushSubscription> {
    const existing = this.subscriptions.find((row) => row.endpoint === input.endpoint);
    if (existing === undefined) {
      const row: StoredPushSubscription = { ...input, unsubscribedAt: null };
      this.subscriptions.push(row);
      return Promise.resolve(row);
    }
    // A re-subscription re-claims the row for the caller: keys, owner, and the unsubscribed
    // stamp cleared — the subscription follows the account that last asked for it.
    const index = this.subscriptions.indexOf(existing);
    const renewed: StoredPushSubscription = { ...input, unsubscribedAt: null };
    this.subscriptions[index] = renewed;
    return Promise.resolve(renewed);
  }

  activeSubscriptionsForUser(userId: number): Promise<readonly StoredPushSubscription[]> {
    return Promise.resolve(
      this.subscriptions.filter((row) => row.userId === userId && row.unsubscribedAt === null),
    );
  }

  markSubscriptionUnsubscribed(userId: number, endpoint: string, at: Date): Promise<number> {
    let changed = 0;
    for (const row of this.subscriptions) {
      if (row.userId !== userId || row.endpoint !== endpoint || row.unsubscribedAt !== null)
        continue;
      const index = this.subscriptions.indexOf(row);
      this.subscriptions[index] = { ...row, unsubscribedAt: at };
      changed += 1;
    }
    return Promise.resolve(changed);
  }
}

/**
 * A transport that records everything it was asked to send, and answers per endpoint. `answers`
 * maps an endpoint to what the push service said; `throwing` is the set of endpoints whose
 * transport call throws — a broken contract the dispatch must count, not propagate (D-29).
 */
class RecordingPushTransport implements PushTransport {
  readonly name = 'webpush';
  readonly sent: PushRequest[] = [];
  answers = new Map<string, PushResult>();
  throwing = new Set<string>();

  send(request: PushRequest): Promise<PushResult> {
    this.sent.push(request);
    if (this.throwing.has(request.subscription.endpoint)) {
      return Promise.reject(new Error('The web-push library is not loaded'));
    }
    const answer = this.answers.get(request.subscription.endpoint);
    return Promise.resolve(answer ?? { delivered: true, gone: false });
  }
}

// ---------------------------------------------------------------- fixtures

const NOW = '2026-09-08T10:00:00.000Z';

function anActor(overrides: Partial<{ userId: number; email: string }> = {}) {
  return {
    userId: 1,
    name: 'Priya Menon',
    role: 'R',
    unitId: null,
    email: 'priya@oneresi.local',
    ...overrides,
  } as const;
}

function aPushEvent(
  overrides: Partial<Pick<OutboxEventInput, 'type' | 'payload'>> = {},
): OutboxEventInput {
  return {
    type: 'visitor.arrived',
    channel: 'PUSH',
    payload: {
      name: 'Priya Menon',
      email: 'priya@oneresi.local',
      visitorName: 'Ravi',
      purpose: 'Delivery',
    },
    correlationId: 'corr-1',
    ...overrides,
  };
}

function aSubscription(overrides: Partial<NewPushSubscription> = {}): NewPushSubscription {
  return {
    userId: 1,
    endpoint: 'https://fcm.googleapis.com/fcm/send/first-device',
    p256dh: 'BIXrPxaZmGWp4d1P0sLQk6mXcVl0xHbTvgzA7lV8bG2bN9uJ3uU0lY5kF1dS4nQmX',
    auth: 'c2VjcmV0LWF1dC1rZXk',
    subscribedAt: new Date(NOW),
    ...overrides,
  };
}

function aService(
  options: { readonly transport?: RecordingPushTransport; readonly store?: MemoryStore } = {},
) {
  const store = options.store ?? new MemoryStore();
  const transport = options.transport ?? new RecordingPushTransport();
  const service = notificationsService({ store, clock: new MutableClock(NOW), push: transport });
  return { service, store, transport };
}

// ---------------------------------------------------------------- the wording

describe('pushNotification', () => {
  it('words the four lock-screen events, and says nothing about the rest', () => {
    expect(pushNotification(aPushEvent())).toEqual({
      title: 'Your visitor has arrived',
      body: 'Ravi has checked in.',
      path: null,
    });

    const pass = pushNotification(
      aPushEvent({
        type: 'pass.created',
        payload: {
          name: 'Priya Menon',
          email: 'priya@oneresi.local',
          visitorName: 'Meera',
          validOn: '2026-09-10T00:00:00.000Z',
          purpose: 'Guest',
        },
      }),
    );
    expect(pass).toEqual({
      title: 'Visitor pass ready',
      body: 'Meera is expected on 2026-09-10.',
      path: null,
    });

    const complaint = pushNotification(
      aPushEvent({
        type: 'complaint.raised',
        payload: {
          name: 'Priya Menon',
          email: 'priya@oneresi.local',
          category: 'PLUMBING',
          subject: 'Kitchen tap',
        },
      }),
    );
    expect(complaint?.body).toContain('Plumbing');

    // Mail's own events, and everything else: no push wording, so the dispatch reports zeros
    // rather than a fabricated message.
    expect(pushNotification(aPushEvent({ type: 'invoice.raised' }))).toBeNull();
    expect(pushNotification({ ...aPushEvent(), channel: 'IN_APP' })).toBeNull();
  });
});

// ---------------------------------------------------------------- dispatchPush

describe('dispatchPush', () => {
  it('sends the wording to every active subscription the person holds', async () => {
    const store = new MemoryStore();
    await store.upsertSubscription(aSubscription());
    await store.upsertSubscription(
      aSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/second-device' }),
    );
    const { service, transport } = aService({ store });

    const result = await service.dispatchPush({ userId: 1, event: aPushEvent() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ addressed: 2, sent: 2, failed: 0, retired: 0, problems: [] });

    // What the device receives: title, body, and a path (null here) — never an origin.
    expect(transport.sent.map((request) => [request.title, request.body, request.path])).toEqual([
      ['Your visitor has arrived', 'Ravi has checked in.', null],
      ['Your visitor has arrived', 'Ravi has checked in.', null],
    ]);
    expect(transport.sent[0]?.correlationId).toBe('corr-1');
  });

  it('answers an event it does not word with zeros, not an error', async () => {
    const store = new MemoryStore();
    await store.upsertSubscription(aSubscription());
    const { service, transport } = aService({ store });

    const result = await service.dispatchPush({
      userId: 1,
      event: aPushEvent({ type: 'invoice.raised' }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Addressed to nobody: the worker marks the row done, because "this surface does not word
    // it" is not a failure and not a retry.
    expect(result.value).toEqual({ addressed: 0, sent: 0, failed: 0, retired: 0, problems: [] });
    expect(transport.sent).toHaveLength(0);
  });

  it('retires a subscription the push service says is gone, and does not count it failed', async () => {
    const store = new MemoryStore();
    await store.upsertSubscription(aSubscription());
    await store.upsertSubscription(
      aSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/dead-device' }),
    );
    const transport = new RecordingPushTransport();
    transport.answers.set('https://fcm.googleapis.com/fcm/send/dead-device', {
      delivered: false,
      gone: true,
    });
    const { service } = aService({ store, transport });

    const result = await service.dispatchPush({ userId: 1, event: aPushEvent() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ addressed: 2, sent: 1, failed: 0, retired: 1 });

    // The dead subscription is retired in the store, so no later dispatch ever tries it again.
    const dead = store.subscriptions.find(
      (row) => row.endpoint === 'https://fcm.googleapis.com/fcm/send/dead-device',
    );
    expect(dead?.unsubscribedAt).toEqual(new Date(NOW));
    // And the next dispatch addresses the one living device only.
    const again = await service.dispatchPush({ userId: 1, event: aPushEvent() });
    expect(again.ok && again.value.addressed).toBe(1);
  });

  it("counts a refused delivery as failed, with the transport's detail in the problems", async () => {
    const store = new MemoryStore();
    await store.upsertSubscription(aSubscription());
    const transport = new RecordingPushTransport();
    transport.answers.set(aSubscription().endpoint, {
      delivered: false,
      gone: false,
      detail: 'status 503: The push service is unavailable',
    });
    const { service } = aService({ store, transport });

    const result = await service.dispatchPush({ userId: 1, event: aPushEvent() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      addressed: 1,
      sent: 0,
      failed: 1,
      retired: 0,
      problems: [
        'https://fcm.googleapis.com/fcm/send/first-device was not delivered: status 503: The push service is unavailable',
      ],
    });
  });

  it('counts a transport that threw, instead of propagating the throw', async () => {
    const store = new MemoryStore();
    await store.upsertSubscription(aSubscription());
    const transport = new RecordingPushTransport();
    transport.throwing.add(aSubscription().endpoint);
    const { service } = aService({ store, transport });

    // A monthly billing run must not fail because push is down (D-29's whole reason for the
    // outbox) — so the throw is counted, never propagated.
    const result = await service.dispatchPush({ userId: 1, event: aPushEvent() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ addressed: 1, sent: 0, failed: 1 });
    expect(result.value.problems[0]).toContain('threw: The web-push library is not loaded');
    // And the subscription is NOT retired — a throw says nothing about the subscription.
    expect(store.subscriptions[0]?.unsubscribedAt).toBeNull();
  });

  it('addresses nobody when the person holds no active subscriptions', async () => {
    const store = new MemoryStore();
    await store.upsertSubscription(aSubscription());
    await store.markSubscriptionUnsubscribed(1, aSubscription().endpoint, new Date(NOW));
    const { service, transport } = aService({ store });

    const result = await service.dispatchPush({ userId: 1, event: aPushEvent() });

    expect(result.ok && result.value).toEqual({
      addressed: 0,
      sent: 0,
      failed: 0,
      retired: 0,
      problems: [],
    });
    expect(transport.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- subscribe and unsubscribe

describe('subscribe', () => {
  it("stores the caller's subscription, and re-claims the row when the same endpoint returns", async () => {
    const { service, store } = aService();
    const other = anActor({ userId: 2, email: 'arjun@oneresi.local' });

    await service.subscribe(anActor(), {
      endpoint: aSubscription().endpoint,
      keys: { p256dh: aSubscription().p256dh, auth: aSubscription().auth },
    });

    // A different account on the same browser re-subscribes: the row follows them — the
    // subscription outlives a sign-in, so it belongs to whoever last asked for it.
    await service.subscribe(other, {
      endpoint: aSubscription().endpoint,
      keys: { p256dh: 'a-rotated-public-key', auth: aSubscription().auth },
    });

    expect(store.subscriptions).toHaveLength(1);
    expect(store.subscriptions[0]).toMatchObject({
      userId: 2,
      p256dh: 'a-rotated-public-key',
      unsubscribedAt: null,
    });

    // Which also means the first account's dispatches no longer reach that browser.
    const result = await service.dispatchPush({ userId: 1, event: aPushEvent() });
    expect(result.ok && result.value.addressed).toBe(0);
  });
});

describe('unsubscribe', () => {
  it("retires the caller's own subscription, and a foreign endpoint changes nothing", async () => {
    const { service, store } = aService();
    await store.upsertSubscription(aSubscription({ userId: 1 }));
    await store.upsertSubscription(
      aSubscription({ userId: 2, endpoint: 'https://fcm.googleapis.com/fcm/send/other' }),
    );

    await service.unsubscribe(anActor(), { endpoint: aSubscription().endpoint });

    expect(store.subscriptions.find((row) => row.userId === 1)?.unsubscribedAt).toEqual(
      new Date(NOW),
    );
    expect(store.subscriptions.find((row) => row.userId === 2)?.unsubscribedAt).toBeNull();

    // An unknown endpoint is a no-op, not an error — the browser may have already dropped it.
    const result = await service.unsubscribe(anActor(), {
      endpoint: 'https://fcm.googleapis.com/fcm/send/gone',
    });
    expect(result.ok).toBe(true);
  });
});
