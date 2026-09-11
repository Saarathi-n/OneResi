import { beforeAll, describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import type { OutboxEventInput } from '@oneresi/domain';
import type { Db } from '../client.js';
import { accountStore } from './accounts.js';

/**
 * The Prisma truth for AccountStore: that the adapter satisfies the port, that a change and its
 * outbox events live and die in one transaction (D-29), that rotation replay is a null, and that
 * the committee's decision is a guarded transition. Every body runs on whichever engine DB_TARGET
 * names — see scripts/run-parity.mjs.
 */

interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}
interface Fixtures {
  readonly aBlock: (db: Db, name?: string) => Promise<{ id: number }>;
  readonly aUnit: (
    db: Db,
    blockId: number,
    overrides?: { label?: string; type?: string; monthlyChargePaise?: number },
  ) => Promise<{ id: number }>;
  readonly aUser: (
    db: Db,
    overrides?: { role?: string; status?: string; unitId?: number; email?: string },
  ) => Promise<{ id: number }>;
  readonly onDay: (iso: string) => Date;
}

const HARNESS = '../../../../test/helpers/database.js';
const FIXTURES = '../../../../test/helpers/fixtures.js';

const { testDatabase } = (await import(HARNESS)) as Harness;
const { aBlock, aUnit, aUser, onDay } = (await import(FIXTURES)) as Fixtures;

let db: Db;

beforeAll(async () => {
  db = (await testDatabase()).db;
});

let eventCounter = 0;
function anEvent(type: OutboxEventInput['type']): OutboxEventInput {
  eventCounter += 1;
  return {
    type,
    channel: 'EMAIL',
    payload: { name: 'Asha', email: 'asha@oneresi.test' },
    correlationId: `corr-${eventCounter}`,
  };
}

const expiry = () => new Date(Date.now() + 15 * 60 * 1000);

describe('createAccount', () => {
  it('writes the account and its outbox events in one transaction', async () => {
    const store = accountStore(db);
    const stamp = onDay('2026-09-08');
    const event = anEvent('resident.registered');

    const created = await store.createAccount(
      {
        name: 'Asha',
        email: 'asha@oneresi.test',
        phone: '+919876500001',
        passwordHash: '$2b$12$stored',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: stamp,
      },
      null,
      () => [event],
    );

    expect(created.role).toBe('R');
    expect(created.status).toBe('PENDING');
    expect(created.passwordChangedAt?.toISOString()).toBe(stamp.toISOString());

    const byEmail = await store.findAccountByEmail('asha@oneresi.test');
    expect(byEmail?.id).toBe(created.id);
    const byId = await store.findAccountById(created.id);
    expect(byId?.passwordHash).toBe('$2b$12$stored');

    const row = await db.outboxEvent.findFirstOrThrow({
      where: { correlationId: event.correlationId },
    });
    expect(row.type).toBe('resident.registered');
    expect(row.channel).toBe('EMAIL');
    expect(row.status).toBe('PENDING');
    expect(JSON.parse(row.payload)).toEqual({ name: 'Asha', email: 'asha@oneresi.test' });
  });

  it('rolls the events back with the account when the transaction fails', async () => {
    const store = accountStore(db);
    const taken = `taken-${eventCounter}@oneresi.test`;
    await aUser(db, { email: taken });
    const event = anEvent('resident.registered');

    // A duplicate email is a unique violation inside the same transaction as the event write.
    await expect(
      store.createAccount(
        {
          name: 'Duplicate',
          email: taken,
          phone: '+919876500002',
          passwordHash: '$2b$12$x',
          role: 'R',
          status: 'PENDING',
          unitId: null,
          passwordChangedAt: onDay('2026-09-08'),
        },
        null,
        () => [event],
      ),
    ).rejects.toThrow();

    // A domain write and its mail may never diverge across transactions (D-29): if the account
    // did not land, the event row did not either.
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);
    expect(await db.residentUser.count({ where: { email: taken } })).toBe(1);
  });

  it('stores a claim with the account, exactly as the applicant gave it, in the same transaction', async () => {
    const store = accountStore(db);
    const event = anEvent('resident.registered');

    const created = await store.createAccount(
      {
        name: 'Claimant',
        email: `claimant-${eventCounter}@oneresi.test`,
        phone: '+919876500003',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: onDay('2026-09-08'),
      },
      { blockName: 'Palm Grove', unitLabel: 'PG-7', unitType: 'VILLA', note: 'corner house' },
      () => [event],
    );

    const claim = await db.registrationClaim.findUniqueOrThrow({ where: { userId: created.id } });
    expect(claim.blockName).toBe('Palm Grove');
    expect(claim.unitLabel).toBe('PG-7');
    expect(claim.unitType).toBe('VILLA');
    expect(claim.note).toBe('corner house');
    expect(claim.resolvedUnitId).toBeNull();
    expect(claim.resolvedAt).toBeNull();

    // The live claim reads back through the port; an account without one reads null.
    expect(await store.findClaim(created.id)).toEqual({
      blockName: 'Palm Grove',
      unitLabel: 'PG-7',
      unitType: 'VILLA',
      note: 'corner house',
    });
    const claimless = await aUser(db);
    expect(await store.findClaim(claimless.id)).toBeNull();

    // The claim row and the event row are children of the same transaction (D-29).
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);
  });

  it('a resubmitted registration is a new account, and each account carries one live claim', async () => {
    const store = accountStore(db);

    const first = await store.createAccount(
      {
        name: 'Reapplicant',
        email: `again-a-${eventCounter}@oneresi.test`,
        phone: '+919876500004',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: onDay('2026-09-08'),
      },
      { blockName: 'Palm Grove', unitLabel: 'PG-7', unitType: 'VILLA', note: 'near the gate' },
      () => [],
    );
    const second = await store.createAccount(
      {
        name: 'Reapplicant',
        email: `again-b-${eventCounter}@oneresi.test`,
        phone: '+919876500005',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: onDay('2026-09-08'),
      },
      { blockName: 'Palm Grove', unitLabel: 'PG-8', unitType: 'FLAT_2BHK', note: null },
      () => [],
    );

    // One claim per account — the unique index is the invariant — and the first applicant's words
    // survive the second attempt untouched: they are the audit of what was decided (D-04, D-47).
    expect((await db.registrationClaim.findUniqueOrThrow({ where: { userId: first.id } })).unitLabel)
      .toBe('PG-7');
    expect((await db.registrationClaim.findUniqueOrThrow({ where: { userId: second.id } })).unitLabel)
      .toBe('PG-8');
  });
});

describe('the password flows', () => {
  it('stores the reset token hash and expiry with its event, and finds the account by the hash', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const expiresAt = expiry();
    const event = anEvent('password.reset_requested');

    await store.setResetToken(person.id, `hash-${person.id}`, expiresAt, [event]);

    const found = await store.findAccountByResetTokenHash(`hash-${person.id}`);
    expect(found?.id).toBe(person.id);
    expect(found?.resetExpiresAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);
  });

  it('reset: new hash and stamp, token cleared, every refresh token revoked', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const earlier = onDay('2026-08-01');
    const stamp = onDay('2026-09-08');

    const alreadyRevoked = await store.createRefreshToken({
      tokenHash: `reset-revoked-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });
    await db.refreshToken.update({ where: { id: alreadyRevoked.id }, data: { revokedAt: earlier } });
    await store.createRefreshToken({
      tokenHash: `reset-live-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });
    await store.setResetToken(person.id, `reset-hash-${person.id}`, expiry(), []);

    await store.applyPasswordReset(person.id, '$2b$12$after-reset', stamp);

    const account = await store.findAccountById(person.id);
    expect(account?.passwordHash).toBe('$2b$12$after-reset');
    expect(account?.passwordChangedAt?.toISOString()).toBe(stamp.toISOString());
    expect(account?.resetTokenHash).toBeNull();
    expect(account?.resetExpiresAt).toBeNull();

    // A token revoked earlier keeps its original revocation — history is not rewritten.
    expect(
      (await store.findRefreshTokenByHash(`reset-revoked-${person.id}`))?.revokedAt?.toISOString(),
    ).toBe(earlier.toISOString());
    expect(
      (await store.findRefreshTokenByHash(`reset-live-${person.id}`))?.revokedAt?.toISOString(),
    ).toBe(stamp.toISOString());
  });

  it('change: revokes every session but leaves the reset token alone', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const stamp = onDay('2026-09-08');
    await store.setResetToken(person.id, `change-hash-${person.id}`, expiry(), []);
    await store.createRefreshToken({
      tokenHash: `change-live-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });

    await store.applyPasswordChange(person.id, '$2b$12$after-change', stamp);

    const account = await store.findAccountById(person.id);
    expect(account?.passwordChangedAt?.toISOString()).toBe(stamp.toISOString());
    expect(account?.resetTokenHash).toBe(`change-hash-${person.id}`);
    expect(
      (await store.findRefreshTokenByHash(`change-live-${person.id}`))?.revokedAt?.toISOString(),
    ).toBe(stamp.toISOString());
  });
});

describe('refresh token rotation', () => {
  it('revokes the old token and stores the replacement linked to it', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const root = await store.createRefreshToken({
      tokenHash: `rot-root-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: 'test-agent',
    });

    const replacement = await store.rotateRefreshToken(root.id, onDay('2026-09-08'), {
      tokenHash: `rot-child-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: root.id,
      userAgent: null,
    });

    expect(replacement?.replacesId).toBe(root.id);
    expect(replacement?.revokedAt).toBeNull();
    expect(
      (await store.findRefreshTokenByHash(`rot-root-${person.id}`))?.revokedAt,
    ).not.toBeNull();
  });

  it('returns null on replay and changes nothing', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const root = await store.createRefreshToken({
      tokenHash: `replay-root-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });
    const first = await store.rotateRefreshToken(root.id, onDay('2026-09-08'), {
      tokenHash: `replay-ok-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: root.id,
      userAgent: null,
    });
    expect(first).not.toBeNull();

    // The replay: the same already-rotated token presented again. Null, and no third row.
    const replay = await store.rotateRefreshToken(root.id, onDay('2026-09-08'), {
      tokenHash: `replay-bad-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: root.id,
      userAgent: null,
    });
    expect(replay).toBeNull();
    expect(await db.refreshToken.count({ where: { userId: person.id } })).toBe(2);
    expect(await store.findRefreshTokenByHash(`replay-bad-${person.id}`)).toBeNull();
  });

  it('lets exactly one of two concurrent rotations win', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const root = await store.createRefreshToken({
      tokenHash: `race-root-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });
    const at = onDay('2026-09-08');

    const [a, b] = await Promise.all([
      store.rotateRefreshToken(root.id, at, {
        tokenHash: `race-a-${person.id}`,
        userId: person.id,
        expiresAt: expiry(),
        replacesId: root.id,
        userAgent: null,
      }),
      store.rotateRefreshToken(root.id, at, {
        tokenHash: `race-b-${person.id}`,
        userId: person.id,
        expiresAt: expiry(),
        replacesId: root.id,
        userAgent: null,
      }),
    ]);

    expect([a, b].filter((outcome) => outcome !== null)).toHaveLength(1);
    expect(await db.refreshToken.count({ where: { userId: person.id } })).toBe(2);
  });
});

describe('family revocation', () => {
  it('revokes the whole chain from any token in it, and nobody else', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const at = onDay('2026-09-08');
    const root = await store.createRefreshToken({
      tokenHash: `fam-root-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });
    const mid = await store.rotateRefreshToken(root.id, at, {
      tokenHash: `fam-mid-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: root.id,
      userAgent: null,
    });
    if (mid === null) throw new Error('mid rotation failed');
    const tip = await store.rotateRefreshToken(mid.id, at, {
      tokenHash: `fam-tip-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: mid.id,
      userAgent: null,
    });
    if (tip === null) throw new Error('tip rotation failed');
    // A different sign-in for the same person: a separate family root.
    await store.createRefreshToken({
      tokenHash: `fam-out-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });

    await store.revokeRefreshFamily(tip.id, at);

    for (const hash of [`fam-root-${person.id}`, `fam-mid-${person.id}`, `fam-tip-${person.id}`]) {
      expect((await store.findRefreshTokenByHash(hash))?.revokedAt).not.toBeNull();
    }
    expect((await store.findRefreshTokenByHash(`fam-out-${person.id}`))?.revokedAt).toBeNull();
  });

  it('follows descendants when revoked from the root', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const at = onDay('2026-09-08');
    const root = await store.createRefreshToken({
      tokenHash: `fam2-root-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });
    const child = await store.rotateRefreshToken(root.id, at, {
      tokenHash: `fam2-child-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: root.id,
      userAgent: null,
    });
    if (child === null) throw new Error('child rotation failed');

    await store.revokeRefreshFamily(root.id, at);

    expect((await store.findRefreshTokenByHash(`fam2-child-${person.id}`))?.revokedAt).not.toBeNull();
  });

  it('revokeAllRefreshTokens leaves other accounts alone', async () => {
    const store = accountStore(db);
    const person = await aUser(db);
    const other = await aUser(db);
    await store.createRefreshToken({
      tokenHash: `all-mine-${person.id}`,
      userId: person.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });
    await store.createRefreshToken({
      tokenHash: `all-theirs-${other.id}`,
      userId: other.id,
      expiresAt: expiry(),
      replacesId: null,
      userAgent: null,
    });

    await store.revokeAllRefreshTokens(person.id, onDay('2026-09-08'));

    expect((await store.findRefreshTokenByHash(`all-mine-${person.id}`))?.revokedAt).not.toBeNull();
    expect((await store.findRefreshTokenByHash(`all-theirs-${other.id}`))?.revokedAt).toBeNull();
  });
});

describe('listPendingApplications', () => {
  it('is the committee queue: PENDING only, oldest first, each with its live claim', async () => {
    const store = accountStore(db);
    const stamp = onDay('2026-09-08');

    // Noise the queue must skip: an active resident, a rejected applicant, and a pending staff
    // account queued behind the committee (D-01) — staff applications are the committee's to
    // decide too, so they ARE listed; the role gate is the service's business, not the store's.
    await aUser(db, { status: 'ACTIVE' });
    await aUser(db, { status: 'REJECTED' });
    const staff = await aUser(db, { role: 'S', status: 'PENDING' });

    const unitless = await store.createAccount(
      {
        name: 'First Applicant',
        email: `queue-a-${eventCounter}@oneresi.test`,
        phone: '+919876500021',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: stamp,
      },
      null,
      () => [],
    );
    const claimant = await store.createAccount(
      {
        name: 'Second Applicant',
        email: `queue-b-${eventCounter}@oneresi.test`,
        phone: '+919876500022',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: stamp,
      },
      { blockName: 'Palm Grove', unitLabel: 'PG-9', unitType: 'VILLA', note: 'by the park' },
      () => [],
    );

    const queue = await store.listPendingApplications();
    const mine = queue.filter(
      (application) =>
        application.userId === unitless.id ||
        application.userId === claimant.id ||
        application.userId === staff.id,
    );
    // Arrival order: createdAt first, id as the tiebreak when the two share a millisecond.
    expect(mine.map((application) => application.userId)).toEqual([
      staff.id,
      unitless.id,
      claimant.id,
    ]);

    const first = mine.find((application) => application.userId === unitless.id);
    expect(first?.name).toBe('First Applicant');
    expect(first?.email).toBe(`queue-a-${eventCounter}@oneresi.test`);
    expect(first?.claim).toBeNull();
    expect(first?.appliedAt instanceof Date).toBe(true);

    const withClaim = mine.find((application) => application.userId === claimant.id);
    expect(withClaim?.claim).toEqual({
      blockName: 'Palm Grove',
      unitLabel: 'PG-9',
      unitType: 'VILLA',
      note: 'by the park',
    });
  });
});

describe('the registration decision', () => {
  it('approves, resolves the claim to a zero-charge home, and writes the event', async () => {
    const store = accountStore(db);
    const event = anEvent('resident.approved');
    const applicant = await store.createAccount(
      {
        name: 'Approved Applicant',
        email: `approved-${eventCounter}@oneresi.test`,
        phone: '+919876500006',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: onDay('2026-09-08'),
      },
      { blockName: 'Palm Grove', unitLabel: 'PG-7', unitType: 'VILLA', note: 'the corner one' },
      () => [],
    );

    const decided = await store.applyRegistrationDecision(
      {
        userId: applicant.id,
        approve: true,
        reason: 'Welcome to Palm Grove',
        claim: {
          blockName: 'Palm Grove',
          unitLabel: 'PG-7',
          unitType: 'VILLA',
          monthlyChargePaise: C.paise(0),
        },
      },
      [event],
    );

    expect(decided?.status).toBe('ACTIVE');
    const unitId = decided?.unitId;
    expect(unitId).toBeTypeOf('number');
    if (unitId === null || unitId === undefined) throw new Error('approval did not link a unit');

    const home = await store.findHome(unitId);
    expect(home?.blockName).toBe('Palm Grove');
    expect(home?.label).toBe('PG-7');
    expect(home?.type).toBe('VILLA');
    // An applicant never sets a charge — the committee's zero stands until an administrator (D-04).
    expect(home?.monthlyChargePaise).toBe(0);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    // The decision is stamped onto the claim's own row: the applicant's words plus what became
    // of them, one row, never deleted (D-04, D-47).
    const claim = await db.registrationClaim.findUniqueOrThrow({ where: { userId: applicant.id } });
    expect(claim.resolvedUnitId).toBe(unitId);
    expect(claim.resolvedAt).not.toBeNull();
    expect(claim.decisionReason).toBe('Welcome to Palm Grove');
    expect(claim.blockName).toBe('Palm Grove');
    expect(claim.note).toBe('the corner one');
    // Approval resolves the claim — it is no longer live.
    expect(await store.findClaim(applicant.id)).toBeNull();
  });

  it('reuses an existing block and unit instead of duplicating them', async () => {
    const store = accountStore(db);
    const applicant = await aUser(db, { status: 'PENDING' });
    const block = await aBlock(db, 'Palm Grove East');
    const existing = await aUnit(db, block.id, {
      label: 'PG-8',
      monthlyChargePaise: C.rupees(100),
    });

    const decided = await store.applyRegistrationDecision(
      {
        userId: applicant.id,
        approve: true,
        reason: null,
        claim: {
          blockName: 'Palm Grove East',
          unitLabel: 'PG-8',
          unitType: 'SHOP',
          monthlyChargePaise: C.paise(0),
        },
      },
      [],
    );

    expect(decided?.unitId).toBe(existing.id);
    expect(await db.block.count({ where: { name: 'Palm Grove East' } })).toBe(1);
    // The existing unit's charge is not overwritten by the resolution's zero.
    expect((await store.findHome(existing.id))?.monthlyChargePaise).toBe(C.rupees(100));
  });

  it('declines to REJECTED, stamps the claim without a unit, and a second decision is a null', async () => {
    const store = accountStore(db);
    const applicant = await store.createAccount(
      {
        name: 'Declined Applicant',
        email: `declined-${eventCounter}@oneresi.test`,
        phone: '+919876500007',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: onDay('2026-09-08'),
      },
      { blockName: 'Ghost Block', unitLabel: 'G-1', unitType: 'FLAT_1BHK', note: 'please' },
      () => [],
    );

    const declined = await store.applyRegistrationDecision(
      { userId: applicant.id, approve: false, reason: 'Not a resident', claim: null },
      [anEvent('resident.declined')],
    );
    expect(declined?.status).toBe('REJECTED');

    // The decline stamps the decision and nothing else: no unit, and the row survives — it is the
    // audit of what was turned down, and what a re-opened application shows the committee.
    const claim = await db.registrationClaim.findUniqueOrThrow({ where: { userId: applicant.id } });
    expect(claim.resolvedUnitId).toBeNull();
    expect(claim.resolvedAt).not.toBeNull();
    expect(claim.decisionReason).toBe('Not a resident');
    expect(claim.note).toBe('please');
    expect(await store.findClaim(applicant.id)).toEqual({
      blockName: 'Ghost Block',
      unitLabel: 'G-1',
      unitType: 'FLAT_1BHK',
      note: 'please',
    });

    const second = await store.applyRegistrationDecision(
      { userId: applicant.id, approve: true, reason: null, claim: null },
      [],
    );
    expect(second).toBeNull();
  });

  it('a re-decided application updates the same claim row, never a second one', async () => {
    const store = accountStore(db);
    const applicant = await store.createAccount(
      {
        name: 'Reopened Applicant',
        email: `reopened-${eventCounter}@oneresi.test`,
        phone: '+919876500008',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'PENDING',
        unitId: null,
        passwordChangedAt: onDay('2026-09-08'),
      },
      { blockName: 'Palm Grove East', unitLabel: 'PG-9', unitType: 'VILLA', note: null },
      () => [],
    );

    await store.applyRegistrationDecision(
      { userId: applicant.id, approve: false, reason: 'Wrong block', claim: null },
      [],
    );
    expect(await db.registrationClaim.count({ where: { userId: applicant.id } })).toBe(1);

    // The committee re-opens the application (REJECTED -> PENDING is the port's machine).
    await db.residentUser.update({ where: { id: applicant.id }, data: { status: 'PENDING' } });

    const approved = await store.applyRegistrationDecision(
      {
        userId: applicant.id,
        approve: true,
        reason: null,
        claim: {
          blockName: 'Palm Grove East',
          unitLabel: 'PG-9',
          unitType: 'VILLA',
          monthlyChargePaise: C.paise(0),
        },
      },
      [],
    );
    expect(approved?.status).toBe('ACTIVE');

    // The decision updated the one row — the unique index on userId holds.
    expect(await db.registrationClaim.count({ where: { userId: applicant.id } })).toBe(1);
    const claim = await db.registrationClaim.findUniqueOrThrow({ where: { userId: applicant.id } });
    expect(claim.resolvedUnitId).toBe(approved?.unitId);
    expect(await store.findClaim(applicant.id)).toBeNull();
  });

  it('creates nothing when the guard fails — not even the claim home', async () => {
    const store = accountStore(db);
    const ghostBlock = `Ghost Block ${eventCounter}`;
    const event = anEvent('resident.approved');
    const settled = await store.createAccount(
      {
        name: 'Settled Applicant',
        email: `settled-${eventCounter}@oneresi.test`,
        phone: '+919876500009',
        passwordHash: '$2b$12$x',
        role: 'R',
        status: 'REJECTED',
        unitId: null,
        passwordChangedAt: onDay('2026-09-08'),
      },
      { blockName: ghostBlock, unitLabel: 'G-1', unitType: 'FLAT_1BHK', note: null },
      () => [],
    );

    // REJECTED cannot go straight to ACTIVE; the decision must not land, and a block for a home
    // the applicant never got must not appear in the database as a side effect.
    const outcome = await store.applyRegistrationDecision(
      {
        userId: settled.id,
        approve: true,
        reason: null,
        claim: {
          blockName: ghostBlock,
          unitLabel: 'G-1',
          unitType: 'FLAT_1BHK',
          monthlyChargePaise: C.paise(0),
        },
      },
      [event],
    );

    expect(outcome).toBeNull();
    expect(await db.block.count({ where: { name: ghostBlock } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);
    // The claim is untouched too: the decision is one transaction, all of it or none of it.
    const claim = await db.registrationClaim.findUniqueOrThrow({ where: { userId: settled.id } });
    expect(claim.resolvedUnitId).toBeNull();
    expect(claim.resolvedAt).toBeNull();
    expect(claim.decisionReason).toBeNull();
  });

  it('re-activates a disabled account, the one approval the state machine allows', async () => {
    const store = accountStore(db);
    const person = await aUser(db, { status: 'DISABLED' });

    const decided = await store.applyRegistrationDecision(
      { userId: person.id, approve: true, reason: null, claim: null },
      [],
    );
    expect(decided?.status).toBe('ACTIVE');
  });
});

describe('the shared lookups', () => {
  it('joins the block into a home', async () => {
    const store = accountStore(db);
    const block = await aBlock(db);
    const unit = await aUnit(db, block.id, { label: 'S-201', monthlyChargePaise: C.rupees(2500) });

    const home = await store.findHome(unit.id);
    expect(home).toEqual({
      unitId: unit.id,
      blockId: block.id,
      blockName: (await db.block.findUniqueOrThrow({ where: { id: block.id } })).name,
      label: 'S-201',
      type: 'FLAT_2BHK',
      monthlyChargePaise: C.rupees(2500),
      active: true,
    });
    expect(await store.findHome(unit.id + 100_000)).toBeNull();
  });

  it('matches block names exactly — case is part of the natural key', async () => {
    const store = accountStore(db);
    const block = await aBlock(db, 'Case Sensitive Block');

    expect((await store.findBlockByName('Case Sensitive Block'))?.id).toBe(block.id);
    expect(await store.findBlockByName('case sensitive block')).toBeNull();
  });

  it('finds a unit by its composite natural key, and the same label in another block is a different unit', async () => {
    const store = accountStore(db);
    const first = await aBlock(db);
    const second = await aBlock(db);
    const unit = await aUnit(db, first.id, { label: 'TWIN-9' });
    await aUnit(db, second.id, { label: 'TWIN-9' });

    const home = await store.findUnitByLabel(first.id, 'TWIN-9');
    expect(home?.unitId).toBe(unit.id);
    expect(await store.findUnitByLabel(first.id, 'twin-9')).toBeNull();
    expect(await store.findUnitByLabel(second.id, 'TWIN-9')).not.toBeNull();
    expect(await store.findUnitByLabel(first.id, 'TWIN-10')).toBeNull();
  });

  it('counts only ACTIVE residents — occupancy is derived, never stored (D-42)', async () => {
    const store = accountStore(db);
    const block = await aBlock(db);
    const unit = await aUnit(db, block.id);
    await aUser(db, { status: 'ACTIVE', unitId: unit.id });
    await aUser(db, { status: 'ACTIVE', unitId: unit.id });
    await aUser(db, { status: 'PENDING', unitId: unit.id });
    await aUser(db, { status: 'REJECTED', unitId: unit.id });
    await aUser(db, { status: 'ACTIVE' });

    expect(await store.countActiveResidentsForUnit(unit.id)).toBe(2);
  });

  it('counts every account of every role and status', async () => {
    const store = accountStore(db);
    const before = await store.countAccounts();
    await aUser(db, { role: 'S', status: 'PENDING' });
    expect(await store.countAccounts()).toBe(before + 1);
  });
});
