'use client';

import { call } from './api';

/**
 * The offline write queue. A mutation attempted with no network is not lost: it is persisted to
 * localStorage with everything needed to replay it, and retried in order the moment
 * connectivity returns. Idempotency keys are generated when the write is FIRST attempted, not
 * when it is retried, so a replay cannot double-charge a payment or double-log a gate entry.
 *
 * Deliberately small and hand-rolled — no queue library, no IndexedDB. The unit of work is one
 * POST the contract accepts as JSON.
 */

const STORAGE_KEY = 'grihaone.replay.v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // a week-old queued write is stale, not pending

export interface QueuedWrite {
  readonly id: string;
  readonly path: string;
  readonly method: string;
  readonly body: unknown;
  /** What the row shows while it waits: "Payment for 2026-08". */
  readonly description: string;
  readonly queuedAt: number;
}

type ChangeListener = (queue: readonly QueuedWrite[]) => void;
const listeners = new Set<ChangeListener>();

let cache: readonly QueuedWrite[] | null = null;
let flushing = false;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 hex chars, as PayInvoiceInput and RecordEntryInput expect. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(): readonly QueuedWrite[] {
  if (cache !== null) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return (cache = []);
    const parsed = JSON.parse(raw) as QueuedWrite[];
    const now = Date.now();
    cache = parsed.filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.path === 'string' &&
        typeof item.description === 'string' &&
        now - item.queuedAt < MAX_AGE_MS,
    );
  } catch {
    cache = [];
  }
  return cache;
}

function persist(next: readonly QueuedWrite[]): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or refused. The queue is a best-effort convenience; the request
    // itself has already failed and the caller has told the person what happened.
  }
  for (const listener of listeners) listener(next);
}

export function queueSnapshot(): readonly QueuedWrite[] {
  return read();
}

export function onChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  listener(read());
  return () => {
    listeners.delete(listener);
  };
}

export function enqueue(
  write: Omit<QueuedWrite, 'id' | 'queuedAt'>,
): QueuedWrite {
  const item: QueuedWrite = { ...write, id: randomId(), queuedAt: Date.now() };
  persist([...read(), item]);
  return item;
}

export function count(): number {
  return read().length;
}

export function flush(): Promise<void> {
  // Check-and-set, synchronously, before any await: a second caller either sees the flag up and
  // returns, or is itself the one that set it — there is no window in which two callers enter.
  if (flushing) return Promise.resolve();
  flushing = true;
  return flushQueue().finally(() => {
    flushing = false;
  });
}

/**
 * Retries every queued write, oldest first, and stops at the first one that still cannot reach
 * the API — order matters (a payment before the pass it pays for, where relevant) and a write
 * the server rejected with a 4xx is removed as permanently failed rather than blocking the rest.
 */
async function flushQueue(): Promise<void> {
  for (;;) {
    const queue = read();
    const first = queue[0];
    if (first === undefined) return;

    const outcome = await call<unknown>(first.path, {
      method: first.method,
      json: first.body,
    });

    if (outcome.ok) {
      persist(read().filter((item) => item.id !== first.id));
      continue;
    }

    if ('network' in outcome && outcome.network) {
      // Still offline. Leave the queue intact and try again on the next signal.
      return;
    }

    if (outcome.error.code === 'UNAUTHENTICATED') {
      // The session died mid-queue. The sign-in flow re-runs flush after a successful sign-in.
      return;
    }

    // The server answered and refused the write (validation, state, conflict). Retrying will
    // not fix it — drop it rather than blocking everything behind it forever.
    persist(read().filter((item) => item.id !== first.id));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flush();
  });
}
