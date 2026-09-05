import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUSES,
  COMPLAINT_STATUSES,
  INVOICE_STATUSES,
  PASS_STATUSES,
  USER_STATUSES,
} from './enums.js';
import {
  BOOKING_TRANSITIONS,
  COMPLAINT_TRANSITIONS,
  INVOICE_TRANSITIONS,
  PASS_TRANSITIONS,
  USER_TRANSITIONS,
} from './rules.js';

/**
 * A status change is a permitted transition, not an assigned string.
 *
 * The previous build let an administrator POST any value, including one outside the enumeration
 * (D-20), which is only possible because no table said what was allowed. These tests assert the
 * tables are total — every enumeration member is a key, every target is a member — so adding a
 * status to an enumeration without deciding how it is reached fails the build.
 */

interface Machine {
  readonly name: string;
  readonly states: readonly string[];
  readonly transitions: Readonly<Record<string, readonly string[]>>;
  /** Where a row starts life, per the schema default. */
  readonly initial: string;
  /** States nothing leaves. A row here is finished. */
  readonly terminal: readonly string[];
}

const MACHINES: readonly Machine[] = [
  {
    name: 'complaint',
    states: COMPLAINT_STATUSES,
    transitions: COMPLAINT_TRANSITIONS,
    initial: 'OPEN',
    terminal: ['CLOSED'],
  },
  {
    name: 'booking',
    states: BOOKING_STATUSES,
    transitions: BOOKING_TRANSITIONS,
    initial: 'PENDING',
    terminal: ['REJECTED', 'CANCELLED', 'COMPLETED'],
  },
  {
    name: 'invoice',
    states: INVOICE_STATUSES,
    transitions: INVOICE_TRANSITIONS,
    initial: 'UNPAID',
    terminal: ['PAID', 'CANCELLED'],
  },
  {
    name: 'pass',
    states: PASS_STATUSES,
    transitions: PASS_TRANSITIONS,
    initial: 'ACTIVE',
    terminal: ['EXPIRED', 'CANCELLED'],
  },
  {
    // A declined applicant may reapply and a suspended account may be restored, so this one has
    // no terminal state at all. UC-18 deactivates rather than deletes.
    name: 'user',
    states: USER_STATUSES,
    transitions: USER_TRANSITIONS,
    initial: 'PENDING',
    terminal: [],
  },
];

describe.each(MACHINES)('$name transitions', (machine) => {
  it('has one key per enumeration member and no others', () => {
    expect(Object.keys(machine.transitions).sort()).toEqual([...machine.states].sort());
  });

  it('targets only members of its own enumeration', () => {
    for (const [from, targets] of Object.entries(machine.transitions)) {
      for (const to of targets) {
        expect(machine.states, `${machine.name}: ${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('lists each target once and never itself', () => {
    for (const [from, targets] of Object.entries(machine.transitions)) {
      expect(new Set(targets).size, `${machine.name}: duplicate target from ${from}`).toBe(
        targets.length,
      );
      expect(targets, `${machine.name}: ${from} transitions to itself`).not.toContain(from);
    }
  });

  it('gives terminal states no outgoing transitions', () => {
    for (const state of machine.terminal) {
      expect(machine.transitions[state], `${machine.name}: ${state} is terminal`).toEqual([]);
    }
  });

  it('declares every dead end as terminal', () => {
    const deadEnds = Object.entries(machine.transitions)
      .filter(([, targets]) => targets.length === 0)
      .map(([state]) => state);
    // A new status with an empty target list is either terminal on purpose — say so here — or a
    // status somebody forgot to finish wiring.
    expect(deadEnds.sort()).toEqual([...machine.terminal].sort());
  });

  it('can reach every state from the one a row starts in', () => {
    expect(machine.states).toContain(machine.initial);

    const reached = new Set([machine.initial]);
    const queue = [machine.initial];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of machine.transitions[current] ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }

    const unreachable = machine.states.filter((state) => !reached.has(state));
    expect(unreachable, `${machine.name}: no path from ${machine.initial}`).toEqual([]);
  });
});

describe('the whole set', () => {
  it('covers every enumeration that a row transitions through', () => {
    expect(MACHINES).toHaveLength(5);
    expect(MACHINES.map((m) => m.name)).toEqual([
      'complaint',
      'booking',
      'invoice',
      'pass',
      'user',
    ]);
  });

  it('allows a backwards edge only where a use case asks for one', () => {
    // Reopening is the one loop in the system and it belongs to complaints (UC-07); a declined
    // applicant reapplying is the other (UC-19). Everywhere else a backwards edge would let a
    // settled invoice or a used pass become live again.
    const loopsBackToInitial = MACHINES.filter((m) =>
      Object.entries(m.transitions).some(([from, targets]) =>
        from !== m.initial ? targets.includes(m.initial) : false,
      ),
    ).map((m) => m.name);

    expect(loopsBackToInitial.sort()).toEqual(['complaint', 'user']);
  });
});
