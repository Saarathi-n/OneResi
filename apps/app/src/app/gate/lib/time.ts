'use client';

/**
 * Time-of-day for the kiosk: "6:42 pm" is what a guard says out loud, and what the shift diary
 * reads. Kept here rather than in the shared lib because the resident screens have no use for it
 * yet — the moment a second surface needs it, it moves to @/lib/format.
 */

const CLOCK = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

export function formatTimeOfDay(value: string | Date): string {
  return CLOCK.format(new Date(value));
}
