import { describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import { accountsService } from './accounts.js';
import { joseAccessToken } from './access-token.js';
import type { AccessTokenSigner } from './access-token.js';
import type { Clock } from './clock.js';
import type { PasswordHasher } from './passwords.js';
import type {
  AccountStore,
  ClaimResolution,
  NewAccount,
  NewRefreshToken,
  OutboxEventInput,
  RateLimiter,
  RateLimitVerdict,
  StoredAccount,
  StoredClaim,
  StoredHome,
  StoredRefreshToken,
} from './store.js';
import type { Actor, AccountsService, RequestMeta, Result, Session } from './ports.js';

/**
 * The accounts service, exercised against fakes that implement the store seam. Every security
 * rule the defect register asked for has a test here: what a replay costs, what a password
 * change kills, what an applicant may never create, and what a committee member may never
 * decide on.
 *
 * The clock is mutable, so expiry is tested by moving a hand — not by faking the global timer,
 * and not by waiting.
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
  advanceMs(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

/** A hasher with no cost at all — the policy is the service's, not the library's. */
const fakeHasher: PasswordHasher = {
  hash: (plain) => Promise.resolve(`fake:${plain}`),
  compare: (plain, stored) => Promise.resolve(stored === `fake:${plain}`),
};

/** Counting only. The window never rolls over inside a test; each case gets a fresh one. */
class MemoryLimiter implements RateLimiter {
  readonly counts = new Map<string, number>();
  consume(
    key: string,
    limit: { attempts: number; windowSeconds: number },
  ): Promise<RateLimitVerdict> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve({
      allowed: count <= limit.attempts,
      retryAfterSeconds: limit.windowSeconds,
    });
  }
  clear(key: string): Promise<void> {
    this.counts.delete(key);
    return Promise.resolve();
  }
}

interface AccountRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: C.Role;
  status: C.UserStatus;
  unitId: number | null;
  passwordChangedAt: Date | null;
  resetTokenHash: string | null;
  resetExpiresAt: Date | null;
  /** Applied-at for the queue; every seeded account shares a fixed instant, the array is the order. */
  createdAt: Date;
}

interface UnitRow {
  unitId: number;
  blockId: number;
  label: string;
  type: C.UnitType;
  monthlyChargePaise: C.Paise;
  active: boolean;
}

/** The mutable shape the fake keeps; snapshots handed out are the readonly StoredRefreshToken. */
interface RefreshRow {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacesId: number | null;
}

/** An in-memory AccountStore: the same contract the db package will implement, minus SQL. */
class MemoryStore implements AccountStore {
  private nextAccountId = 1;
  private nextBlockId = 1;
  private nextUnitId = 1;
  private nextTokenId = 1;
  readonly accounts: AccountRow[] = [];
  readonly blocks: { id: number; name: string }[] = [];
  readonly units: UnitRow[] = [];
  readonly refreshTokens: RefreshRow[] = [];
  readonly claims = new Map<number, StoredClaim>();
  readonly outbox: OutboxEventInput[] = [];
  /** Test hook: simulate a concurrent decision landing between check and apply. */
  forceNextDecisionNull = false;

  // ---- seeding, test-only

  seedBlock(name: string): number {
    const id = this.nextBlockId++;
    this.blocks.push({ id, name });
    return id;
  }

  seedUnit(
    blockId: number,
    label: string,
    options: { type?: C.UnitType; chargePaise?: number; active?: boolean } = {},
  ): number {
    const unitId = this.nextUnitId++;
    this.units.push({
      unitId,
      blockId,
      label,
      type: options.type ?? 'FLAT_2BHK',
      monthlyChargePaise: C.paise(options.chargePaise ?? 250_000),
      active: options.active ?? true,
    });
    return unitId;
  }

  seedAccount(
    row: Omit<AccountRow, 'id' | 'resetTokenHash' | 'resetExpiresAt' | 'createdAt'>,
  ): AccountRow {
    const account: AccountRow = {
      ...row,
      id: this.nextAccountId++,
      resetTokenHash: null,
      resetExpiresAt: null,
      createdAt: new Date('2026-09-08T09:00:00Z'),
    };
    this.accounts.push(account);
    return account;
  }

  /** Direct state surgery for testing what happens when the world changes under a session. */
  patchAccount(id: number, patch: Partial<AccountRow>): void {
    const account = this.accounts.find((a) => a.id === id);
    if (account === undefined) throw new Error(`no account ${id}`);
    Object.assign(account, patch);
  }

  // ---- lookups

  private snapshot(account: AccountRow): StoredAccount {
    return { ...account };
  }

  findAccountByEmail(email: string): Promise<StoredAccount | null> {
    return this.lookupAccount((a) => a.email === email);
  }

  findAccountById(id: number): Promise<StoredAccount | null> {
    return this.lookupAccount((a) => a.id === id);
  }

  findAccountByResetTokenHash(tokenHash: string): Promise<StoredAccount | null> {
    return this.lookupAccount((a) => a.resetTokenHash === tokenHash);
  }

  private lookupAccount(
    predicate: (account: AccountRow) => boolean,
  ): Promise<StoredAccount | null> {
    const account = this.accounts.find(predicate);
    return Promise.resolve(account === undefined ? null : this.snapshot(account));
  }

  findHome(unitId: number): Promise<StoredHome | null> {
    const unit = this.units.find((u) => u.unitId === unitId);
    const block = unit === undefined ? undefined : this.blocks.find((b) => b.id === unit.blockId);
    if (unit === undefined || block === undefined) return Promise.resolve(null);
    return Promise.resolve({
      unitId: unit.unitId,
      blockId: unit.blockId,
      blockName: block.name,
      label: unit.label,
      type: unit.type,
      monthlyChargePaise: unit.monthlyChargePaise,
      active: unit.active,
    });
  }

  findBlockByName(name: string): Promise<{ id: number } | null> {
    const block = this.blocks.find((b) => b.name === name);
    return Promise.resolve(block === undefined ? null : { id: block.id });
  }

  findUnitByLabel(blockId: number, label: string): Promise<StoredHome | null> {
    const unit = this.units.find((u) => u.blockId === blockId && u.label === label);
    return unit === undefined ? Promise.resolve(null) : this.findHome(unit.unitId);
  }

  countActiveResidentsForUnit(unitId: number): Promise<number> {
    return Promise.resolve(
      this.accounts.filter(
        (a) => a.unitId === unitId && a.role === 'R' && a.status === 'ACTIVE',
      ).length,
    );
  }

  countAccounts(): Promise<number> {
    return Promise.resolve(this.accounts.length);
  }

  findCommitteeMembers(): Promise<
    readonly { id: number; name: string; email: string }[]
  > {
    return Promise.resolve(
      this.accounts
        .filter((a) => a.role === 'A' && a.status === 'ACTIVE')
        .map((a) => ({ id: a.id, name: a.name, email: a.email })),
    );
  }

  // ---- writes (each one is "a transaction" in the real store)

  createAccount(
    input: NewAccount,
    claim: StoredClaim | null,
    eventsFor: (account: StoredAccount) => readonly OutboxEventInput[],
  ): Promise<StoredAccount> {
    const account: AccountRow = {
      id: this.nextAccountId++,
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: input.role,
      status: input.status,
      unitId: input.unitId,
      passwordChangedAt: input.passwordChangedAt,
      resetTokenHash: null,
      resetExpiresAt: null,
      createdAt: new Date('2026-09-08T09:00:00Z'),
    };
    this.accounts.push(account);
    if (claim !== null) this.claims.set(account.id, claim);
    this.outbox.push(...eventsFor(this.snapshot(account)));
    return Promise.resolve(this.snapshot(account));
  }

  findClaim(userId: number): Promise<StoredClaim | null> {
    return Promise.resolve(this.claims.get(userId) ?? null);
  }

  /** The queue: PENDING accounts in arrival order, each with the live claim the fake holds. */
  listPendingApplications(): Promise<
    readonly {
      userId: number;
      name: string;
      email: string;
      phone: string;
      appliedAt: Date;
      claim: StoredClaim | null;
    }[]
  > {
    return Promise.resolve(
      this.accounts
        .filter((account) => account.status === 'PENDING')
        .map((account) => ({
          userId: account.id,
          name: account.name,
          email: account.email,
          phone: account.phone,
          appliedAt: account.createdAt,
          claim: this.claims.get(account.id) ?? null,
        })),
    );
  }

  applyRegistrationDecision(
    input: { userId: number; approve: boolean; reason: string | null; claim: ClaimResolution | null },
    events: readonly OutboxEventInput[],
  ): Promise<StoredAccount | null> {
    if (this.forceNextDecisionNull) {
      this.forceNextDecisionNull = false;
      return Promise.resolve(null);
    }
    const account = this.accounts.find((a) => a.id === input.userId);
    if (account === undefined || account.status !== 'PENDING') return Promise.resolve(null);

    if (input.approve) {
      account.status = 'ACTIVE';
      const resolution = input.claim;
      if (resolution !== null) {
        let block = this.blocks.find((b) => b.name === resolution.blockName);
        if (block === undefined) {
          block = { id: this.nextBlockId++, name: resolution.blockName };
          this.blocks.push(block);
        }
        let unit = this.units.find(
          (u) => u.blockId === block.id && u.label === resolution.unitLabel,
        );
        if (unit === undefined) {
          unit = {
            unitId: this.nextUnitId++,
            blockId: block.id,
            label: resolution.unitLabel,
            type: resolution.unitType,
            monthlyChargePaise: resolution.monthlyChargePaise,
            active: true,
          };
          this.units.push(unit);
        }
        account.unitId = unit.unitId;
        this.claims.delete(account.id);
      }
    } else {
      account.status = 'REJECTED';
    }
    this.outbox.push(...events);
    return Promise.resolve(this.snapshot(account));
  }

  setResetToken(
    userId: number,
    tokenHash: string,
    expiresAt: Date,
    events: readonly OutboxEventInput[],
  ): Promise<void> {
    const account = this.accounts.find((a) => a.id === userId);
    if (account === undefined) throw new Error(`no account ${userId}`);
    account.resetTokenHash = tokenHash;
    account.resetExpiresAt = expiresAt;
    this.outbox.push(...events);
    return Promise.resolve();
  }

  applyPasswordReset(
    userId: number,
    passwordHash: string,
    passwordChangedAt: Date,
  ): Promise<void> {
    const account = this.accounts.find((a) => a.id === userId);
    if (account === undefined) throw new Error(`no account ${userId}`);
    account.passwordHash = passwordHash;
    account.passwordChangedAt = passwordChangedAt;
    account.resetTokenHash = null;
    account.resetExpiresAt = null;
    this.revokeAllFor(userId, passwordChangedAt);
    return Promise.resolve();
  }

  applyPasswordChange(
    userId: number,
    passwordHash: string,
    passwordChangedAt: Date,
  ): Promise<void> {
    const account = this.accounts.find((a) => a.id === userId);
    if (account === undefined) throw new Error(`no account ${userId}`);
    account.passwordHash = passwordHash;
    account.passwordChangedAt = passwordChangedAt;
    this.revokeAllFor(userId, passwordChangedAt);
    return Promise.resolve();
  }

  // ---- refresh tokens

  private revokeAllFor(userId: number, at: Date): void {
    for (const token of this.refreshTokens) {
      if (token.userId === userId && token.revokedAt === null) token.revokedAt = at;
    }
  }

  private insertRefreshToken(input: NewRefreshToken): RefreshRow {
    const token: RefreshRow = {
      id: this.nextTokenId++,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacesId: input.replacesId,
    };
    this.refreshTokens.push(token);
    return token;
  }

  createRefreshToken(input: NewRefreshToken): Promise<StoredRefreshToken> {
    return Promise.resolve({ ...this.insertRefreshToken(input) });
  }

  findRefreshTokenByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const token = this.refreshTokens.find((t) => t.tokenHash === tokenHash);
    return Promise.resolve(token === undefined ? null : { ...token });
  }

  rotateRefreshToken(
    oldId: number,
    revokedAt: Date,
    replacement: NewRefreshToken,
  ): Promise<StoredRefreshToken | null> {
    const old = this.refreshTokens.find((t) => t.id === oldId);
    if (old === undefined || old.revokedAt !== null) return Promise.resolve(null);
    old.revokedAt = revokedAt;
    return Promise.resolve({ ...this.insertRefreshToken(replacement) });
  }

  revokeRefreshFamily(tokenId: number, revokedAt: Date): Promise<void> {
    let current = this.refreshTokens.find((t) => t.id === tokenId);
    if (current === undefined) return Promise.resolve();
    while (current.replacesId !== null) {
      const parent = this.refreshTokens.find((t) => t.id === current?.replacesId);
      if (parent === undefined) break;
      current = parent;
    }
    const familyIds = new Set<number>();
    const collect = (id: number): void => {
      if (familyIds.has(id)) return;
      familyIds.add(id);
      for (const child of this.refreshTokens) {
        if (child.replacesId === id) collect(child.id);
      }
    };
    collect(current.id);
    for (const token of this.refreshTokens) {
      if (familyIds.has(token.id) && token.revokedAt === null) token.revokedAt = revokedAt;
    }
    return Promise.resolve();
  }

  revokeAllRefreshTokens(userId: number, revokedAt: Date): Promise<void> {
    this.revokeAllFor(userId, revokedAt);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------- harness

const SECRET = new TextEncoder().encode('test-secret-that-is-long-enough-32b');

interface Harness {
  service: AccountsService;
  store: MemoryStore;
  limiter: MemoryLimiter;
  clock: MutableClock;
  tokens: AccessTokenSigner;
}

function harness(): Harness {
  const clock = new MutableClock('2026-09-08T09:00:00Z');
  const store = new MemoryStore();
  const limiter = new MemoryLimiter();
  const tokens = joseAccessToken(SECRET, clock);
  const service = accountsService({
    store,
    limiter,
    hasher: fakeHasher,
    tokens,
    env: { clock, jwtSecret: SECRET },
  });
  return { service, store, limiter, clock, tokens };
}

const META: RequestMeta = { ip: '203.0.113.9', userAgent: 'vitest', correlationId: 'corr-1' };

const PASSWORD = 'Reasonable1!';

/** A parsed registration body — the service only ever sees what contracts accepted. */
function registerInput(overrides: Partial<C.RegisterInput> = {}): C.RegisterInput {
  const body = {
    name: 'Asha Rao',
    email: 'asha@example.com',
    phone: '9886012345',
    password: PASSWORD,
    home: { kind: 'existing' as const, unitId: 1 },
    ...overrides,
  };
  return C.RegisterInput.parse(body);
}

function signInInput(email: string, password: string): C.SignInInput {
  return C.SignInInput.parse({ email, password });
}

/** A seeded, ACTIVE resident on a seeded unit, plus an ACTIVE administrator. */
function seededWorld(store: MemoryStore): {
  unitId: number;
  residentId: number;
  adminId: number;
} {
  const blockId = store.seedBlock('Brindavan');
  const unitId = store.seedUnit(blockId, 'B-101');
  const resident = store.seedAccount({
    name: 'Asha Rao',
    email: 'asha@example.com',
    phone: '9886012345',
    passwordHash: `fake:${PASSWORD}`,
    role: 'R',
    status: 'ACTIVE',
    unitId,
    passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
  });
  const admin = store.seedAccount({
    name: 'Meera Committee',
    email: 'meera@example.com',
    phone: '9886012000',
    passwordHash: `fake:${PASSWORD}`,
    role: 'A',
    status: 'ACTIVE',
    unitId: null,
    passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
  });
  return { unitId, residentId: resident.id, adminId: admin.id };
}

async function signInOk(service: AccountsService, email: string): Promise<Session> {
  return signInOkWith(service, email, PASSWORD);
}

async function signInOkWith(
  service: AccountsService,
  email: string,
  password: string,
): Promise<Session> {
  const result = await service.signIn(signInInput(email, password), META);
  if (!result.ok) throw new Error(`sign-in failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

function actorFor(store: MemoryStore, id: number): Actor {
  const account = store.accounts.find((a) => a.id === id);
  if (account === undefined) throw new Error(`no account ${id}`);
  return {
    userId: account.id,
    name: account.name,
    role: account.role,
    unitId: account.unitId,
    email: account.email,
  };
}

const expectError = async <T>(
  result: Promise<Result<T>>,
  code: string,
): Promise<{ code: string; message: string; field?: string }> => {
  const settled = await result;
  if (settled.ok) throw new Error('expected a failure, got a value');
  expect(settled.error.code).toBe(code);
  return settled.error;
};

// ---------------------------------------------------------------- tests

describe('signIn', () => {
  it('returns a session with both tokens and a home, and stores only the hash', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');

    expect(session.person.id).toBeGreaterThan(0);
    expect(session.person.email).toBe('asha@example.com');
    expect(session.person.home?.unitId).toBe(unitId);
    expect(session.person.home?.blockName).toBe('Brindavan');
    expect(session.refreshToken).not.toContain('fake:');
    expect(session.accessToken.length).toBeGreaterThan(20);

    // Only the SHA-256 is stored; the plaintext never reaches the store (D-24).
    const stored = world.store.refreshTokens.map((t) => t.tokenHash);
    expect(stored).toContain(C.hashToken(session.refreshToken));
    expect(stored).not.toContain(session.refreshToken);
  });

  it('refuses an unknown email and a wrong password with the same message', async () => {
    const world = harness();
    seededWorld(world.store);

    const unknown = await expectError(
      world.service.signIn(signInInput('ghost@example.com', 'Whatever1!'), META),
      'UNAUTHENTICATED',
    );
    const wrong = await expectError(
      world.service.signIn(signInInput('asha@example.com', 'WrongPass1!'), META),
      'UNAUTHENTICATED',
    );
    // Identical in code AND message — an enumeration oracle would live in the difference (D-39).
    expect(unknown.message).toBe(wrong.message);
  });

  it('tells a pending applicant their application is awaiting review', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    world.store.seedAccount({
      name: 'New Person',
      email: 'new@example.com',
      phone: '9886012399',
      passwordHash: `fake:${PASSWORD}`,
      role: 'R',
      status: 'PENDING',
      unitId,
      passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
    });
    const error = await expectError(
      world.service.signIn(signInInput('new@example.com', PASSWORD), META),
      'STATE_NOT_ALLOWED',
    );
    expect(error.message).toContain('awaiting review');
  });

  it('refuses a disabled account without naming the status', async () => {
    const world = harness();
    seededWorld(world.store);
    world.store.patchAccount(
      world.store.accounts.find((a) => a.email === 'asha@example.com')?.id ?? -1,
      { status: 'DISABLED' },
    );
    const error = await expectError(
      world.service.signIn(signInInput('asha@example.com', PASSWORD), META),
      'STATE_NOT_ALLOWED',
    );
    expect(error.message).not.toContain('DISABLED');
  });

  it('locks out after the limit and forgives after a success', async () => {
    const world = harness();
    seededWorld(world.store);

    // Seven wrong, then the right one: allowed, and the window clears.
    for (let i = 0; i < 7; i += 1) {
      await world.service.signIn(signInInput('asha@example.com', 'WrongPass1!'), META);
    }
    expect((await signInOk(world.service, 'asha@example.com')).person.email).toBe(
      'asha@example.com',
    );

    // Seven more wrong (the streak restarted), then the right one again.
    for (let i = 0; i < 7; i += 1) {
      await world.service.signIn(signInInput('asha@example.com', 'WrongPass1!'), META);
    }
    await signInOk(world.service, 'asha@example.com');

    // An eighth consecutive failure bars even the correct password.
    for (let i = 0; i < 8; i += 1) {
      await world.service.signIn(signInInput('asha@example.com', 'WrongPass1!'), META);
    }
    await expectError(
      world.service.signIn(signInInput('asha@example.com', PASSWORD), META),
      'RATE_LIMITED',
    );
  });
});

describe('refresh rotation and family revocation', () => {
  it('rotates: the replacement works and the old token is dead', async () => {
    const world = harness();
    seededWorld(world.store);
    const first = await signInOk(world.service, 'asha@example.com');

    const second = await world.service.refresh(first.refreshToken, META);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.refreshToken).not.toBe(first.refreshToken);

    const replay = await world.service.refresh(first.refreshToken, META);
    expect(replay.ok).toBe(false);
  });

  it('kills the whole family on replay — the stolen-child case (D-24)', async () => {
    const world = harness();
    seededWorld(world.store);
    const first = await signInOk(world.service, 'asha@example.com');

    const second = await world.service.refresh(first.refreshToken, META);
    if (!second.ok) throw new Error('second refresh failed');
    const third = await world.service.refresh(second.value.refreshToken, META);
    if (!third.ok) throw new Error('third refresh failed');

    // The thief replays the grandparent. Every descendant — including the one the real user
    // now holds — must die, or the thief simply waits for the next rotation.
    await world.service.refresh(first.refreshToken, META);

    await expectError(
      world.service.refresh(third.value.refreshToken, META),
      'UNAUTHENTICATED',
    );
    await expectError(
      world.service.refresh(second.value.refreshToken, META),
      'UNAUTHENTICATED',
    );
  });

  it('refuses an expired refresh token', async () => {
    const world = harness();
    seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');

    world.clock.advanceMs((C.REFRESH_TOKEN_TTL_SECONDS + 60) * 1000);
    await expectError(world.service.refresh(session.refreshToken, META), 'UNAUTHENTICATED');
  });

  it('refuses an unknown refresh token', async () => {
    const world = harness();
    await expectError(world.service.refresh(C.secretToken(), META), 'UNAUTHENTICATED');
  });

  it('ends a disabled account at refresh, not at token expiry (D-24)', async () => {
    const world = harness();
    seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');

    const resident = world.store.accounts.find((a) => a.email === 'asha@example.com');
    if (resident === undefined) throw new Error('seed broken');
    world.store.patchAccount(resident.id, { status: 'DISABLED' });

    const error = await expectError(world.service.refresh(session.refreshToken, META), 'STATE_NOT_ALLOWED');
    expect(error.message).not.toContain('DISABLED');
    // And the family is revoked, so re-enabling the account does not resurrect the session.
    const stored = world.store.refreshTokens.filter((t) => t.userId === resident.id);
    expect(stored.every((t) => t.revokedAt !== null)).toBe(true);
  });
});

describe('signOut', () => {
  it('revokes the family, idempotently', async () => {
    const world = harness();
    seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');
    const rotated = await world.service.refresh(session.refreshToken, META);
    expect(rotated.ok).toBe(true);

    const out = await world.service.signOut(rotated.ok ? rotated.value.refreshToken : '');
    expect(out.ok).toBe(true);

    await expectError(world.service.refresh(session.refreshToken, META), 'UNAUTHENTICATED');
    // A second sign-out with a dead token is fine — signing out is not an error state.
    const again = await world.service.signOut(session.refreshToken);
    expect(again.ok).toBe(true);
  });

  it('succeeds on an unknown token', async () => {
    const world = harness();
    const result = await world.service.signOut(C.secretToken());
    expect(result.ok).toBe(true);
  });
});

describe('register', () => {
  it('bootstraps an empty society: the first applicant is ACTIVE, everyone after is PENDING', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const unitId = world.store.seedUnit(blockId, 'B-101');

    const first = await world.service.register(registerInput(), { ...META, correlationId: 'c-1' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstAccount = world.store.accounts.find((a) => a.email === 'asha@example.com');
    expect(firstAccount?.status).toBe('ACTIVE');
    expect(firstAccount?.role).toBe('R');
    expect(firstAccount?.unitId).toBe(unitId);
    expect(firstAccount?.passwordChangedAt).not.toBeNull();

    const second = await world.service.register(
      registerInput({ email: 'second@example.com' }),
      { ...META, correlationId: 'c-2' },
    );
    expect(second.ok).toBe(true);
    expect(
      world.store.accounts.find((a) => a.email === 'second@example.com')?.status,
    ).toBe('PENDING');
  });

  it('queues behind the committee once any account exists, and never escalates role (D-01)', async () => {
    const world = harness();
    seededWorld(world.store);
    const result = await world.service.register(
      registerInput({ email: 'new@example.com' }),
      META,
    );
    expect(result.ok).toBe(true);
    const account = world.store.accounts.find((a) => a.email === 'new@example.com');
    expect(account?.status).toBe('PENDING');
    expect(account?.role).toBe('R');
  });

  it('writes the registration email to the outbox with the correlation id', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    world.store.seedUnit(blockId, 'B-101');
    // The registration mail is committee-facing: one row per ACTIVE committee member.
    world.store.seedAccount({
      name: 'Meera Committee',
      email: 'meera@example.com',
      phone: '9886012000',
      passwordHash: `fake:${PASSWORD}`,
      role: 'A',
      status: 'ACTIVE',
      unitId: null,
      passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await world.service.register(registerInput(), { ...META, correlationId: 'corr-42' });

    const event = world.store.outbox.find((e) => e.type === 'resident.registered');
    expect(event?.channel).toBe('EMAIL');
    expect(event?.correlationId).toBe('corr-42');
    expect(event?.payload.email).toBe('meera@example.com');
    expect(event?.payload.applicantName).toBe('Asha Rao');
    expect(event?.payload.applicantId).toBeGreaterThan(0);
    expect(event?.payload.home).toBe('Brindavan · B-101');
    expect(typeof event?.payload.submittedAt).toBe('string');
  });

  it('tells the committee the claim in their own words when the unit is not on the list', async () => {
    const world = harness();
    world.store.seedAccount({
      name: 'Meera Committee',
      email: 'meera@example.com',
      phone: '9886012000',
      passwordHash: `fake:${PASSWORD}`,
      role: 'A',
      status: 'ACTIVE',
      unitId: null,
      passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await world.service.register(
      registerInput({
        email: 'claimant@example.com',
        home: {
          kind: 'claim',
          blockName: 'Palm Grove',
          unitLabel: 'pg-7',
          unitType: 'FLAT_2BHK',
          note: 'It is the corner house',
        },
      }),
      META,
    );

    const event = world.store.outbox.find((e) => e.type === 'resident.registered');
    expect(event?.payload.home).toBe('Palm Grove · PG-7');
    expect(event?.payload.claimNote).toBe('It is the corner house');
  });

  it('refuses a duplicate email', async () => {
    const world = harness();
    seededWorld(world.store);
    await expectError(
      world.service.register(registerInput({ email: 'asha@example.com' }), META),
      'CONFLICT',
    );
  });

  it('refuses an unknown or inactive home', async () => {
    const world = harness();
    await expectError(
      world.service.register(registerInput({ home: { kind: 'existing', unitId: 999 } }), META),
      'NOT_FOUND',
    );

    const blockId = world.store.seedBlock('Old Block');
    const inactive = world.store.seedUnit(blockId, 'B-1', { active: false });
    await expectError(
      world.service.register(registerInput({ home: { kind: 'existing', unitId: inactive } }), META),
      'NOT_FOUND',
    );
  });

  it('refuses a full unit — six ACTIVE residents is six (D-77, D-42)', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Full Block');
    const unitId = world.store.seedUnit(blockId, 'B-1');
    for (let i = 0; i < C.MAX_OCCUPANTS_PER_UNIT; i += 1) {
      world.store.seedAccount({
        name: `Resident ${i}`,
        email: `resident${i}@example.com`,
        phone: '9886012300',
        passwordHash: `fake:${PASSWORD}`,
        role: 'R',
        status: 'ACTIVE',
        unitId,
        passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
      });
    }
    await expectError(
      world.service.register(registerInput({ home: { kind: 'existing', unitId } }), META),
      'LIMIT_REACHED',
    );
  });

  it('stores a claim as a description — no block, no unit, no charge (D-04)', async () => {
    const world = harness();
    seededWorld(world.store);
    const unitsBefore = world.store.units.length;
    const blocksBefore = world.store.blocks.length;

    const result = await world.service.register(
      registerInput({
        email: 'claimant@example.com',
        home: {
          kind: 'claim',
          blockName: 'Palm Grove',
          unitLabel: 'pg-7',
          unitType: 'FLAT_2BHK',
          note: 'It is the corner house',
        },
      }),
      META,
    );
    expect(result.ok).toBe(true);

    const account = world.store.accounts.find((a) => a.email === 'claimant@example.com');
    expect(account?.unitId).toBeNull();
    expect(account?.status).toBe('PENDING');

    const claim = account ? world.store.claims.get(account.id) : undefined;
    expect(claim?.blockName).toBe('Palm Grove');
    expect(claim?.unitLabel).toBe('PG-7'); // normalised by contracts, not trusted from the body
    expect(claim?.note).toBe('It is the corner house');

    expect(world.store.units.length).toBe(unitsBefore);
    expect(world.store.blocks.length).toBe(blocksBefore);
  });

  it('rate limits registrations per ip', async () => {
    const world = harness();
    seededWorld(world.store);
    for (let i = 0; i < C.RATE_LIMITS.register.attempts; i += 1) {
      await world.service.register(
        registerInput({ email: `batch${i}@example.com` }),
        META,
      );
    }
    await expectError(
      world.service.register(registerInput({ email: 'onemore@example.com' }), META),
      'RATE_LIMITED',
    );
  });
});

describe('password reset', () => {
  async function requestReset(world: Harness): Promise<string> {
    const result = await world.service.requestPasswordReset(
      C.RequestPasswordResetInput.parse({ email: 'asha@example.com' }),
      { ...META, correlationId: 'reset-1' },
    );
    expect(result.ok).toBe(true);
    const event = world.store.outbox.find((e) => e.type === 'password.reset_requested');
    if (event === undefined) throw new Error('no reset event');
    const token = event.payload.token;
    if (typeof token !== 'string') throw new Error('reset event has no token');
    return token;
  }

  it('emails a reset link and stores only the hash (D-22)', async () => {
    const world = harness();
    seededWorld(world.store);
    const token = await requestReset(world);

    const resident = world.store.accounts.find((a) => a.email === 'asha@example.com');
    expect(resident?.resetTokenHash).toBe(C.hashToken(token));
    expect(JSON.stringify(world.store.accounts)).not.toContain(token);
  });

  it('answers ok for an unknown email, with no email sent', async () => {
    const world = harness();
    seededWorld(world.store);
    const result = await world.service.requestPasswordReset(
      C.RequestPasswordResetInput.parse({ email: 'ghost@example.com' }),
      META,
    );
    expect(result.ok).toBe(true);
    expect(world.store.outbox.filter((e) => e.type === 'password.reset_requested')).toHaveLength(0);
  });

  it('rate limits reset requests', async () => {
    const world = harness();
    seededWorld(world.store);
    for (let i = 0; i < C.RATE_LIMITS.passwordReset.attempts; i += 1) {
      await world.service.requestPasswordReset(
        C.RequestPasswordResetInput.parse({ email: 'asha@example.com' }),
        META,
      );
    }
    await expectError(
      world.service.requestPasswordReset(
        C.RequestPasswordResetInput.parse({ email: 'asha@example.com' }),
        META,
      ),
      'RATE_LIMITED',
    );
  });

  it('completes a reset: new password works, old one does not, sessions are dead', async () => {
    const world = harness();
    seededWorld(world.store);
    const before = await signInOk(world.service, 'asha@example.com');
    const token = await requestReset(world);

    const done = await world.service.completePasswordReset(
      C.CompletePasswordResetInput.parse({ token, password: 'FreshPass2#' }),
    );
    expect(done.ok).toBe(true);

    await expectError(
      world.service.signIn(signInInput('asha@example.com', PASSWORD), META),
      'UNAUTHENTICATED',
    );
    await signInOkWith(world.service, 'asha@example.com', 'FreshPass2#');
    // The single-use token is gone, and the pre-reset refresh token was revoked.
    await expectError(
      world.service.completePasswordReset(
        C.CompletePasswordResetInput.parse({ token, password: 'FreshPass3#' }),
      ),
      'INVALID_INPUT',
    );
    await expectError(world.service.refresh(before.refreshToken, META), 'UNAUTHENTICATED');
  });

  it('refuses an expired or unknown token, without distinguishing them by timing shape', async () => {
    const world = harness();
    seededWorld(world.store);
    const token = await requestReset(world);

    world.clock.advanceMs((C.PASSWORD_RESET_TTL_SECONDS + 1) * 1000);
    const expired = await expectError(
      world.service.completePasswordReset(
        C.CompletePasswordResetInput.parse({ token, password: 'FreshPass2#' }),
      ),
      'INVALID_INPUT',
    );
    expect(expired.message).toContain('expired');

    await expectError(
      world.service.completePasswordReset(
        C.CompletePasswordResetInput.parse({ token: C.secretToken(), password: 'FreshPass2#' }),
      ),
      'INVALID_INPUT',
    );
  });
});

describe('resolveActor and the password stamp (D-23, D-24)', () => {
  it('resolves a fresh access token to the actor', async () => {
    const world = harness();
    const { residentId, unitId } = seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');

    const actor = await world.service.resolveActor(session.accessToken);
    expect(actor.ok).toBe(true);
    if (!actor.ok) return;
    expect(actor.value.userId).toBe(residentId);
    expect(actor.value.role).toBe('R');
    expect(actor.value.unitId).toBe(unitId);
  });

  it('refuses garbage, tampered and expired access tokens', async () => {
    const world = harness();
    seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');

    await expectError(world.service.resolveActor('not-a-token'), 'UNAUTHENTICATED');
    await expectError(world.service.resolveActor(`${session.accessToken}x`), 'UNAUTHENTICATED');

    world.clock.advanceMs((C.ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
    await expectError(world.service.resolveActor(session.accessToken), 'UNAUTHENTICATED');
  });

  it('kills sessions across a password change — the D-23 rule', async () => {
    const world = harness();
    seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');
    const resident = world.store.accounts.find((a) => a.email === 'asha@example.com');
    if (resident === undefined) throw new Error('seed broken');

    const changed = await world.service.changePassword(
      actorFor(world.store, resident.id),
      { currentPassword: PASSWORD, newPassword: 'Different9!' },
    );
    expect(changed.ok).toBe(true);

    // The access token predates the change: refused even though the signature is intact.
    await expectError(world.service.resolveActor(session.accessToken), 'UNAUTHENTICATED');
    // So does the refresh token: all of them were revoked.
    await expectError(world.service.refresh(session.refreshToken, META), 'UNAUTHENTICATED');
    // And a fresh sign-in — with the new password — works and carries the new stamp.
    const fresh = await signInOkWith(world.service, 'asha@example.com', 'Different9!');
    const actor = await world.service.resolveActor(fresh.accessToken);
    expect(actor.ok).toBe(true);
  });

  it('refuses the token of a disabled account regardless of the stamp (D-24)', async () => {
    const world = harness();
    seededWorld(world.store);
    const session = await signInOk(world.service, 'asha@example.com');
    const resident = world.store.accounts.find((a) => a.email === 'asha@example.com');
    if (resident === undefined) throw new Error('seed broken');
    world.store.patchAccount(resident.id, { status: 'DISABLED' });

    await expectError(world.service.resolveActor(session.accessToken), 'UNAUTHENTICATED');
  });

  it('refuses a token issued before a reset changed the password', async () => {
    const world = harness();
    seededWorld(world.store);
    const before = await signInOk(world.service, 'asha@example.com');

    // Request and complete a reset — the stamp moves to "now", which is after the token's.
    await world.service.requestPasswordReset(
      C.RequestPasswordResetInput.parse({ email: 'asha@example.com' }),
      META,
    );
    const event = world.store.outbox.find((e) => e.type === 'password.reset_requested');
    const token = event !== undefined && typeof event.payload.token === 'string' ? event.payload.token : '';
    await world.service.completePasswordReset(
      C.CompletePasswordResetInput.parse({ token, password: 'FreshPass2#' }),
    );

    await expectError(world.service.resolveActor(before.accessToken), 'UNAUTHENTICATED');
  });
});

describe('changePassword', () => {
  it('refuses a wrong current password and a weak new one', async () => {
    const world = harness();
    seededWorld(world.store);
    const resident = world.store.accounts.find((a) => a.email === 'asha@example.com');
    if (resident === undefined) throw new Error('seed broken');
    const actor = actorFor(world.store, resident.id);

    const wrongCurrent = await expectError(
      world.service.changePassword(actor, { currentPassword: 'Nope1234!', newPassword: 'Different9!' }),
      'INVALID_INPUT',
    );
    expect(wrongCurrent.field).toBe('currentPassword');

    const weakNew = await expectError(
      world.service.changePassword(actor, { currentPassword: PASSWORD, newPassword: 'short' }),
      'INVALID_INPUT',
    );
    expect(weakNew.field).toBe('newPassword');

    // Nothing changed: the old password still signs in.
    await signInOk(world.service, 'asha@example.com');
  });
});

describe('me', () => {
  it('returns the person view for a live actor', async () => {
    const world = harness();
    const { residentId, unitId } = seededWorld(world.store);
    const me = await world.service.me(actorFor(world.store, residentId));
    expect(me.ok).toBe(true);
    if (!me.ok) return;
    expect(me.value.id).toBe(residentId);
    expect(me.value.home?.unitId).toBe(unitId);
  });

  it('refuses an actor whose account was disabled after the token was issued', async () => {
    const world = harness();
    seededWorld(world.store);
    const resident = world.store.accounts.find((a) => a.email === 'asha@example.com');
    if (resident === undefined) throw new Error('seed broken');
    world.store.patchAccount(resident.id, { status: 'DISABLED' });
    await expectError(world.service.me(actorFor(world.store, resident.id)), 'STATE_NOT_ALLOWED');
  });
});

describe('decideRegistration', () => {
  async function pendingApplicant(
    world: Harness,
    email = 'applicant@example.com',
    unitId = 1,
  ): Promise<number> {
    const result = await world.service.register(
      registerInput({ email, home: { kind: 'existing', unitId } }),
      META,
    );
    if (!result.ok) throw new Error('register failed');
    const account = world.store.accounts.find((a) => a.email === email);
    if (account === undefined) throw new Error('applicant missing');
    return account.id;
  }

  it('approves: PENDING becomes ACTIVE, with the decided email', async () => {
    const world = harness();
    seededWorld(world.store);
    const admin = world.store.accounts.find((a) => a.role === 'A');
    if (admin === undefined) throw new Error('no admin');
    const applicantId = await pendingApplicant(world);

    const decided = await world.service.decideRegistration(
      actorFor(world.store, admin.id),
      C.DecideRegistrationInput.parse({ userId: applicantId, decision: 'APPROVE' }),
      { ...META, correlationId: 'dec-1' },
    );
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.value.status).toBe('ACTIVE');
    expect(world.store.outbox.find((e) => e.type === 'resident.approved')).toBeDefined();
    expect(world.store.accounts.find((a) => a.id === applicantId)?.status).toBe('ACTIVE');
  });

  it('declines with a reason: PENDING becomes REJECTED, and nothing is occupied', async () => {
    const world = harness();
    seededWorld(world.store);
    const admin = world.store.accounts.find((a) => a.role === 'A');
    if (admin === undefined) throw new Error('no admin');
    const applicantId = await pendingApplicant(world);

    const decided = await world.service.decideRegistration(
      actorFor(world.store, admin.id),
      C.DecideRegistrationInput.parse({
        userId: applicantId,
        decision: 'DECLINE',
        reason: 'That flat is rented to someone else',
      }),
      META,
    );
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.value.status).toBe('REJECTED');

    const event = world.store.outbox.find((e) => e.type === 'resident.declined');
    expect(event?.payload.reason).toBe('That flat is rented to someone else');
    // REJECTED holds no slot: the unit still admits a registration.
    expect(await world.store.countActiveResidentsForUnit(1)).toBe(1);
  });

  it('resolves a claim on approval: block and unit are created here, at zero charge (D-04)', async () => {
    const world = harness();
    seededWorld(world.store);
    const admin = world.store.accounts.find((a) => a.role === 'A');
    if (admin === undefined) throw new Error('no admin');
    await world.service.register(
      registerInput({
        email: 'claimant@example.com',
        home: {
          kind: 'claim',
          blockName: 'Palm Grove',
          unitLabel: 'pg-7',
          unitType: 'FLAT_2BHK',
        },
      }),
      META,
    );
    const claimant = world.store.accounts.find((a) => a.email === 'claimant@example.com');
    if (claimant === undefined) throw new Error('claimant missing');
    const blocksBefore = world.store.blocks.length;

    const decided = await world.service.decideRegistration(
      actorFor(world.store, admin.id),
      C.DecideRegistrationInput.parse({ userId: claimant.id, decision: 'APPROVE' }),
      META,
    );
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;

    expect(decided.value.home?.blockName).toBe('Palm Grove');
    expect(decided.value.home?.label).toBe('PG-7');
    // Zero until an administrator sets it — the applicant never set a charge.
    expect(decided.value.home?.monthlyChargePaise).toBe(0);
    expect(world.store.blocks.length).toBe(blocksBefore + 1);
    expect(world.store.claims.has(claimant.id)).toBe(false);
  });

  it('refuses a non-admin, a disabled admin, and a staff target (D-42)', async () => {
    const world = harness();
    seededWorld(world.store);
    const admin = world.store.accounts.find((a) => a.role === 'A');
    if (admin === undefined) throw new Error('no admin');
    const resident = world.store.accounts.find((a) => a.role === 'R');
    if (resident === undefined) throw new Error('no resident');
    const applicantId = await pendingApplicant(world);

    await expectError(
      world.service.decideRegistration(
        actorFor(world.store, resident.id),
        C.DecideRegistrationInput.parse({ userId: applicantId, decision: 'APPROVE' }),
        META,
      ),
      'FORBIDDEN',
    );

    world.store.patchAccount(admin.id, { status: 'DISABLED' });
    await expectError(
      world.service.decideRegistration(
        actorFor(world.store, admin.id),
        C.DecideRegistrationInput.parse({ userId: applicantId, decision: 'APPROVE' }),
        META,
      ),
      'FORBIDDEN',
    );
    world.store.patchAccount(admin.id, { status: 'ACTIVE' });

    const staff = world.store.seedAccount({
      name: 'Gate Desk',
      email: 'gate@example.com',
      phone: '9886012100',
      passwordHash: `fake:${PASSWORD}`,
      role: 'S',
      status: 'PENDING',
      unitId: null,
      passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
    });
    await expectError(
      world.service.decideRegistration(
        actorFor(world.store, admin.id),
        C.DecideRegistrationInput.parse({ userId: staff.id, decision: 'APPROVE' }),
        META,
      ),
      'FORBIDDEN',
    );
  });

  it('refuses a decision outside USER_TRANSITIONS, and an unknown application', async () => {
    const world = harness();
    seededWorld(world.store);
    const admin = world.store.accounts.find((a) => a.role === 'A');
    if (admin === undefined) throw new Error('no admin');
    const applicantId = await pendingApplicant(world);

    await world.service.decideRegistration(
      actorFor(world.store, admin.id),
      C.DecideRegistrationInput.parse({ userId: applicantId, decision: 'APPROVE' }),
      META,
    );
    // ACTIVE -> APPROVE again is not a permitted transition (D-20).
    await expectError(
      world.service.decideRegistration(
        actorFor(world.store, admin.id),
        C.DecideRegistrationInput.parse({ userId: applicantId, decision: 'APPROVE' }),
        META,
      ),
      'STATE_NOT_ALLOWED',
    );

    await expectError(
      world.service.decideRegistration(
        actorFor(world.store, admin.id),
        C.DecideRegistrationInput.parse({ userId: 4242, decision: 'APPROVE' }),
        META,
      ),
      'NOT_FOUND',
    );
  });

  it('reports "already decided" when a concurrent decision landed first', async () => {
    const world = harness();
    seededWorld(world.store);
    const admin = world.store.accounts.find((a) => a.role === 'A');
    if (admin === undefined) throw new Error('no admin');
    const applicantId = await pendingApplicant(world);

    world.store.forceNextDecisionNull = true;
    const error = await expectError(
      world.service.decideRegistration(
        actorFor(world.store, admin.id),
        C.DecideRegistrationInput.parse({ userId: applicantId, decision: 'APPROVE' }),
        META,
      ),
      'STATE_NOT_ALLOWED',
    );
    expect(error.message).toContain('already decided');
  });

  it('re-checks occupancy at the moment of approval', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Filling Block');
    const unitId = world.store.seedUnit(blockId, 'B-1');
    for (let i = 0; i < C.MAX_OCCUPANTS_PER_UNIT; i += 1) {
      world.store.seedAccount({
        name: `Resident ${i}`,
        email: `resident${i}@example.com`,
        phone: '9886012300',
        passwordHash: `fake:${PASSWORD}`,
        role: 'R',
        status: 'ACTIVE',
        unitId,
        passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
      });
    }
    const admin = world.store.seedAccount({
      name: 'Meera Committee',
      email: 'meera@example.com',
      phone: '9886012000',
      passwordHash: `fake:${PASSWORD}`,
      role: 'A',
      status: 'ACTIVE',
      unitId: null,
      passwordChangedAt: new Date('2026-08-01T00:00:00Z'),
    });
    // The applicant registered against a DIFFERENT unit (this one is full); the committee
    // reassignment — or another resident activating in between — is what the re-check catches.
    const freeUnitId = world.store.seedUnit(blockId, 'B-2');
    const applicantId = await pendingApplicant(world, 'applicant@example.com', freeUnitId);
    world.store.patchAccount(applicantId, { unitId });

    await expectError(
      world.service.decideRegistration(
        actorFor(world.store, admin.id),
        C.DecideRegistrationInput.parse({ userId: applicantId, decision: 'APPROVE' }),
        META,
      ),
      'LIMIT_REACHED',
    );
    expect(world.store.accounts.find((a) => a.id === applicantId)?.status).toBe('PENDING');
  });
});

describe('pendingApplications', () => {
  it('gives the committee the queue with each claim; a resident and a disabled admin get nothing', async () => {
    const world = harness();
    const { residentId, adminId } = seededWorld(world.store);
    await world.service.register(registerInput({ email: 'waiter@example.com' }), META);
    await world.service.register(
      registerInput({
        email: 'dreamer@example.com',
        home: {
          kind: 'claim',
          blockName: 'Palm Grove',
          unitLabel: 'pg-3',
          unitType: 'VILLA',
        },
      }),
      META,
    );

    const queue = await world.service.pendingApplications(actorFor(world.store, adminId));
    expect(queue.ok).toBe(true);
    if (!queue.ok) return;
    expect(queue.value.map((application) => application.email)).toEqual([
      'waiter@example.com',
      'dreamer@example.com',
    ]);
    // The words, exactly as given — resolved only at approval (D-04).
    expect(queue.value[1]?.claim).toMatchObject({
      blockName: 'Palm Grove',
      unitLabel: 'PG-3',
      unitType: 'VILLA',
    });
    expect(queue.value[0]?.claim).toBeNull();
    expect(queue.value[0]?.appliedAt instanceof Date).toBe(true);

    await expectError(
      world.service.pendingApplications(actorFor(world.store, residentId)),
      'FORBIDDEN',
    );
    // A disabled administrator's token must not read the queue either (D-24).
    world.store.patchAccount(adminId, { status: 'DISABLED' });
    await expectError(
      world.service.pendingApplications(actorFor(world.store, adminId)),
      'FORBIDDEN',
    );
  });
});
