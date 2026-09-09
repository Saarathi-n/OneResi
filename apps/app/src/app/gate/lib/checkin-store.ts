'use client';

/**
 * Who is inside because THIS kiosk checked them in, today. The route map gives the gate no read
 * route for society-wide state — a checked-in pass answers any later code lookup with "already
 * used", so it cannot be re-derived from the API. The kiosk therefore keeps its own day-scoped
 * list: written on every check-in this device records, read back for check-outs, and rolled over
 * to empty at the start of each day so yesterday's visitors never linger on the screen.
 *
 * localStorage, not React state, so a kiosk reload or a browser restart mid-shift does not cost
 * the guard the list of who is still inside.
 */

export interface OpenCheckIn {
  readonly passId: number;
  readonly visitorName: string;
  readonly purpose: string;
  readonly destination: string;
  readonly checkedInAt: string;
}

const STORAGE_KEY = 'oneresi.gate.checkins.v1';

interface StoredDay {
  readonly date: string;
  readonly entries: readonly OpenCheckIn[];
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function isEntry(value: unknown): value is OpenCheckIn {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.passId === 'number' &&
    typeof entry.visitorName === 'string' &&
    typeof entry.purpose === 'string' &&
    typeof entry.destination === 'string' &&
    typeof entry.checkedInAt === 'string'
  );
}

function readDay(): StoredDay {
  if (typeof window === 'undefined') return { date: dayKey(new Date()), entries: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { date: dayKey(new Date()), entries: [] };
    const parsed = JSON.parse(raw) as Partial<StoredDay>;
    if (
      typeof parsed.date !== 'string' ||
      parsed.date !== dayKey(new Date()) ||
      !Array.isArray(parsed.entries)
    ) {
      // A new day, or a shape we do not recognise: start clean rather than guessing.
      return { date: dayKey(new Date()), entries: [] };
    }
    return { date: parsed.date, entries: parsed.entries.filter(isEntry) };
  } catch {
    return { date: dayKey(new Date()), entries: [] };
  }
}

function writeDay(day: StoredDay): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(day));
  } catch {
    // Storage refused or full. The check-in itself already reached the server; only the
    // kiosk-local conveniences (the check-out list) degrade.
  }
}

/** Everyone this kiosk checked in today and has not yet checked out, oldest first. */
export function openCheckIns(): readonly OpenCheckIn[] {
  return readDay().entries;
}

/** Records a check-in this device made. Called only after the server accepted it. */
export function addOpenCheckIn(entry: OpenCheckIn): void {
  const day = readDay();
  writeDay({ date: day.date, entries: [...day.entries, entry] });
}

/** Removes a visitor after a successful check-out (or a check-out the server says already happened). */
export function removeOpenCheckIn(passId: number): void {
  const day = readDay();
  writeDay({ date: day.date, entries: day.entries.filter((item) => item.passId !== passId) });
}

/** The last unit a walk-in was logged for, so the next one starts one tap from done. */
const WALK_IN_PREFILL_KEY = 'oneresi.gate.walkin.v1';

export interface WalkInPrefill {
  readonly blockId: number;
  readonly unitId: number;
}

export function readWalkInPrefill(): WalkInPrefill | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(WALK_IN_PREFILL_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<WalkInPrefill>;
    if (typeof parsed.blockId !== 'number' || typeof parsed.unitId !== 'number') return null;
    return { blockId: parsed.blockId, unitId: parsed.unitId };
  } catch {
    return null;
  }
}

export function writeWalkInPrefill(prefill: WalkInPrefill): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WALK_IN_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // A convenience only. Refusing storage costs one extra tap, nothing more.
  }
}
