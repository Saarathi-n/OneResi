import { describe, expect, it } from 'vitest';

describe('Human-Readable Due Date Sentences', () => {
  function deriveDueStatus(dueIso: string, nowIso: string): string {
    const due = new Date(dueIso.slice(0, 10) + 'T00:00:00.000Z').getTime();
    const now = new Date(nowIso.slice(0, 10) + 'T00:00:00.000Z').getTime();
    const diffDays = Math.round((due - now) / 86_400_000);

    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    if (diffDays > 1) return `Due in ${diffDays} days`;
    if (diffDays === -1) return 'Overdue by 1 day';
    return `Overdue by ${Math.abs(diffDays)} days`;
  }

  it('formats future due dates in plain human sentences', () => {
    expect(deriveDueStatus('2026-09-15', '2026-09-12')).toBe('Due in 3 days');
    expect(deriveDueStatus('2026-09-13', '2026-09-12')).toBe('Due tomorrow');
    expect(deriveDueStatus('2026-09-12', '2026-09-12')).toBe('Due today');
  });

  it('formats overdue dates accurately', () => {
    expect(deriveDueStatus('2026-09-11', '2026-09-12')).toBe('Overdue by 1 day');
    expect(deriveDueStatus('2026-09-08', '2026-09-12')).toBe('Overdue by 4 days');
    expect(deriveDueStatus('2026-08-12', '2026-09-12')).toBe('Overdue by 31 days');
  });

  it('handles month boundary transitions safely', () => {
    expect(deriveDueStatus('2026-10-02', '2026-09-30')).toBe('Due in 2 days');
    expect(deriveDueStatus('2026-09-29', '2026-10-01')).toBe('Overdue by 2 days');
  });
});
