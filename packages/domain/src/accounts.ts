import * as C from '@oneresi/contracts';
import type {
  Actor,
  AccountsService,
  ApplicationView,
  PersonView,
  RequestMeta,
  Result,
  Session,
  HomeView,
} from './ports.js';
import { errors } from './errors.js';
import type { AccountsDeps } from './deps.js';
import type {
  StoredAccount,
  StoredHome,
  StoredClaim,
  ClaimResolution,
  OutboxEventInput,
} from './store.js';

/**
 * Accounts: registration, sign-in, refresh rotation, password reset and change, the committee's
 * decision.
 *
 * Design consequences, each closing a defect from the register:
 *
 *  - the password hash crosses the store seam only for comparison; it never enters a view or a
 *    log (D-12)
 *  - role and status are decided by rules below, never accepted from a request body (D-01)
 *  - an unauthenticated applicant selects an existing unit or describes one they claim; they can
 *    never create a block, create a unit, or set a charge (D-04)
 *  - access tokens live 15 minutes and carry `passwordChangedAt`; every request re-checks it
 *    against the live account, so a password change kills the sessions it was issued before
 *    (D-23, D-24)
 *  - a refresh token is single use and stored hashed; a replay of a rotated token revokes the
 *    whole family, so a copied token is worthless rather than valid for a fortnight (D-24)
 *  - the first resident activates the society themselves; everyone after waits for the committee
 */

/** The mail template's variable block, as the outbox payload for an account event. */
type MailPayload = Readonly<Record<string, string | number | boolean | null>>;

function mailEvent(
  type: C.OutboxEventType,
  payload: MailPayload,
  correlationId: string,
): OutboxEventInput {
  // The mail worker renders EMAIL for these event types; every account event here is email.
  return { type, channel: 'EMAIL', payload, correlationId };
}

function personHomeView(home: StoredHome): HomeView {
  return {
    unitId: home.unitId,
    blockName: home.blockName,
    label: home.label,
    type: home.type,
    monthlyChargePaise: home.monthlyChargePaise,
  };
}

async function homeFor(deps: AccountsDeps, account: StoredAccount): Promise<HomeView | null> {
  if (account.unitId === null) return null;
  const home = await deps.store.findHome(account.unitId);
  return home === null ? null : personHomeView(home);
}

/** A PersonView with the hash and every internal column already gone (D-12). */
function personView(account: StoredAccount, home: HomeView | null): PersonView {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
    role: account.role,
    status: account.status,
    home,
  };
}

function personPayload(name: string, email: string): MailPayload {
  return { name, email };
}

/** The claim as the committee reads it: their block and label, not a unit that exists yet. */
function claimDescription(home: C.RegisterInput['home']): string {
  return home.kind === 'claim'
    ? `${home.blockName} · ${home.unitLabel}`
    : 'an existing home';
}

/** passwordChangedAt as whole seconds — the resolution an access token's `pwd` claim carries. */
function pwdStampSeconds(account: StoredAccount): number | null {
  return account.passwordChangedAt === null
    ? null
    : Math.floor(account.passwordChangedAt.getTime() / 1000);
}

/** Signs an access token stamped with the account's CURRENT passwordChangedAt (D-23). */
async function signAccess(
  deps: AccountsDeps,
  account: StoredAccount,
  now: Date,
): Promise<{ readonly token: string; readonly expiresAt: Date }> {
  const token = await deps.tokens.sign(
    {
      sub: account.id,
      role: account.role,
      unitId: account.unitId,
      email: account.email,
      pwd: pwdStampSeconds(account),
    },
    now,
  );
  return {
    token,
    expiresAt: new Date(now.getTime() + C.ACCESS_TOKEN_TTL_SECONDS * 1000),
  };
}

async function buildSession(
  deps: AccountsDeps,
  account: StoredAccount,
  now: Date,
  userAgent: string | null,
  replacesId: number | null,
): Promise<Session> {
  const refreshPlain = C.secretToken();
  const access = await signAccess(deps, account, now);
  const stored = await deps.store.createRefreshToken({
    tokenHash: C.hashToken(refreshPlain),
    userId: account.id,
    expiresAt: new Date(now.getTime() + C.REFRESH_TOKEN_TTL_SECONDS * 1000),
    replacesId,
    userAgent,
  });

  return {
    accessToken: access.token,
    refreshToken: refreshPlain,
    person: personView(account, await homeFor(deps, account)),
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt: stored.expiresAt,
  };
}

/** ACTIVE and reachable. PENDING and DISABLED get distinct, user-safe messages. */
function activeAccountGate(account: StoredAccount): Result<StoredAccount> {
  if (account.status === 'PENDING') {
    return errors.stateNotAllowed('Your application is awaiting review.');
  }
  if (account.status !== 'ACTIVE') {
    // DISABLED and REJECTED. One message; the status is not the requester's business (D-39).
    return errors.stateNotAllowed('This account is not available. Please contact the office.');
  }
  return { ok: true, value: account };
}

/**
 * The timing-equalising compare for "no such account" branches. A real bcrypt hash of an
 * unsatisfiable password is computed once per process, so the unknown-email path does the same
 * work as the wrong-password path and response time stops being an account-existence oracle
 * (D-39). A hardcoded literal would not work — comparing against a malformed hash fails fast,
 * which is the very signal this exists to remove.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyCompare(deps: AccountsDeps, plain: string): Promise<boolean> {
  dummyHashPromise ??= deps.hasher.hash('no-account-has-this-password');
  return dummyHashPromise.then((hashValue) => deps.hasher.compare(plain, hashValue));
}

/** The home a claim resolves to: the claim's description, at a charge of zero until an
 *  administrator sets one — an applicant never sets a charge, and a charge is what every
 *  invoice snapshots (D-04). */
function resolutionFrom(claim: StoredClaim): ClaimResolution {
  return {
    blockName: claim.blockName,
    unitLabel: claim.unitLabel,
    unitType: claim.unitType,
    monthlyChargePaise: C.paise(0),
  };
}

// ---------------------------------------------------------------- the service

/** The return type is the seam: if this object stops satisfying `AccountsService`, it stops
 *  compiling. */
export function accountsService(deps: AccountsDeps): AccountsService {
  return {
    async resolveActor(accessToken: string): Promise<Result<Actor>> {
      const claims = await deps.tokens.verify(accessToken);
      if (claims === null) return errors.unauthenticated();

      const account = await deps.store.findAccountById(claims.sub);
      if (account === null || account.status !== 'ACTIVE') {
        // A disabled account keeps no sessions, however valid the signature (D-24).
        return errors.unauthenticated();
      }

      const stamp = pwdStampSeconds(account);
      if (stamp === null || claims.pwd === null || claims.pwd < stamp) {
        // The token was issued before the last password change. Dead on arrival (D-23).
        return errors.unauthenticated();
      }

      return {
        ok: true,
        value: {
          userId: account.id,
          name: account.name,
          role: account.role,
          unitId: account.unitId,
          email: account.email,
        },
      };
    },

    async signIn(input: C.SignInInput, meta: RequestMeta): Promise<Result<Session>> {
      const now = deps.env.clock.now();
      const limitKey = `signIn:${input.email}`;
      const verdict = await deps.limiter.consume(limitKey, C.RATE_LIMITS.signIn);
      if (!verdict.allowed) return errors.rateLimited(verdict.retryAfterSeconds);

      const account = await deps.store.findAccountByEmail(input.email);
      if (account === null) {
        // Equal work for an unknown email, so timing does not reveal which addresses exist.
        await dummyCompare(deps, input.password);
        return errors.badCredentials();
      }

      const passwordOk = await deps.hasher.compare(input.password, account.passwordHash);
      if (!passwordOk) return errors.badCredentials();

      const gate = activeAccountGate(account);
      if (!gate.ok) return gate;

      // A successful sign-in forgives the streak; the limit exists to stop a brute force, not
      // to lock a person out of their own account after eight typos.
      await deps.limiter.clear(limitKey);

      const session = await buildSession(deps, account, now, meta.userAgent, null);
      return { ok: true, value: session };
    },

    async signOut(refreshToken: string): Promise<Result<null>> {
      // Only the refresh token can be revoked server-side — the access token is a 15-minute
      // credential and dies on its own (D-24). Revoking the family catches every descendant of
      // the presented token too.
      const now = deps.env.clock.now();
      const record = await deps.store.findRefreshTokenByHash(C.hashToken(refreshToken));
      if (record === null) {
        // Idempotent: an unknown token is already as signed-out as it can be.
        return { ok: true, value: null };
      }
      await deps.store.revokeRefreshFamily(record.id, now);
      return { ok: true, value: null };
    },

    async refresh(refreshToken: string, meta: RequestMeta): Promise<Result<Session>> {
      const now = deps.env.clock.now();
      const record = await deps.store.findRefreshTokenByHash(C.hashToken(refreshToken));

      if (record === null) {
        return errors.unauthenticated();
      }

      if (record.expiresAt.getTime() <= now.getTime()) {
        return errors.unauthenticated();
      }

      if (record.revokedAt !== null) {
        // Replay of an already-rotated token. The family the sign-in created is revoked — every
        // descendant, not just this row — because a replay is the signature of a stolen token,
        // and a thief who holds a parent likely holds a child (D-24).
        await deps.store.revokeRefreshFamily(record.id, now);
        return errors.unauthenticated();
      }

      const account = await deps.store.findAccountById(record.userId);
      if (account === null) {
        // The account vanished under the token. Nothing to refresh to.
        await deps.store.revokeRefreshFamily(record.id, now);
        return errors.unauthenticated();
      }

      const gate = activeAccountGate(account);
      if (!gate.ok) {
        // DISABLED: access ends here, not at token expiry — the fortnight-long window was D-24.
        await deps.store.revokeRefreshFamily(record.id, now);
        return gate;
      }

      const replacementPlain = C.secretToken();
      const replacement = {
        tokenHash: C.hashToken(replacementPlain),
        userId: account.id,
        expiresAt: new Date(now.getTime() + C.REFRESH_TOKEN_TTL_SECONDS * 1000),
        replacesId: record.id,
        userAgent: meta.userAgent,
      };

      // Null return = someone else rotated this row between our two awaits. Same answer as a
      // replay: kill the family and ask for a fresh sign-in.
      const rotated = await deps.store.rotateRefreshToken(record.id, now, replacement);
      if (rotated === null) {
        await deps.store.revokeRefreshFamily(record.id, now);
        return errors.unauthenticated();
      }

      const access = await signAccess(deps, account, now);
      return {
        ok: true,
        value: {
          accessToken: access.token,
          refreshToken: replacementPlain,
          person: personView(account, await homeFor(deps, account)),
          accessExpiresAt: access.expiresAt,
          refreshExpiresAt: rotated.expiresAt,
        },
      };
    },

    async register(
      input: C.RegisterInput,
      meta: RequestMeta,
    ): Promise<Result<{ personId: number }>> {
      const now = deps.env.clock.now();
      const limit = await deps.limiter.consume(`register:${meta.ip}`, C.RATE_LIMITS.register);
      if (!limit.allowed) return errors.rateLimited(limit.retryAfterSeconds);

      const existing = await deps.store.findAccountByEmail(input.email);
      if (existing !== null) {
        // Same message whether the address is taken or the person is already registered — this
        // endpoint is unauthenticated, and existence is not a fact to give away.
        return errors.conflict('An application already exists for this email.');
      }

      let unitId: number | null = null;
      let claim: StoredClaim | null = null;

      if (input.home.kind === 'existing') {
        const home = await deps.store.findHome(input.home.unitId);
        if (home === null || !home.active) {
          return errors.notFound('home');
        }
        if (
          (await deps.store.countActiveResidentsForUnit(home.unitId)) >= C.MAX_OCCUPANTS_PER_UNIT
        ) {
          // Six is an implementation decision, recorded as such (D-77). Occupancy counts ACTIVE
          // residents only, so a declined applicant never held a slot (D-42).
          return errors.limitReached('That home is already full.');
        }
        unitId = home.unitId;
      } else {
        // A description, not a write. No Block row, no Unit row, no charge — an administrator
        // resolves all three during approval (D-04).
        claim = {
          blockName: input.home.blockName,
          unitLabel: input.home.unitLabel,
          unitType: input.home.unitType,
          note: input.home.note ?? null,
        };
      }

      const passwordHash = await deps.hasher.hash(input.password);

      // The bootstrap rule: an empty society's first applicant activates immediately as a
      // resident; every later applicant waits for the committee. The previous build's answer to
      // a fresh database was a login page that signed the applicant in as an administrator with
      // a literal password (D-01).
      const isFirstResident = (await deps.store.countAccounts()) === 0;

      // The home the committee reads on the application: the existing unit they registered
      // against, or their own words for one that is not on the list yet.
      const existingHome = unitId === null ? null : await deps.store.findHome(unitId);
      const home = existingHome === null ? claimDescription(input.home) : `${existingHome.blockName} · ${existingHome.label}`;

      // The application notification is committee-facing mail (it links into the review queue),
      // so it is one row per ACTIVE committee member — the same rule facilities keeps for a
      // booking request. An empty society has no committee to notify: the first resident
      // activates immediately and the queue they would sit in does not exist yet.
      const committee =
        isFirstResident ? [] : await deps.store.findCommitteeMembers();

      const account = await deps.store.createAccount(
        {
          name: input.name,
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: 'R',
          status: isFirstResident ? 'ACTIVE' : 'PENDING',
          unitId,
          passwordChangedAt: now,
        },
        claim,
        (created) =>
          committee.map((member) =>
            mailEvent(
              'resident.registered',
              {
                name: member.name,
                email: member.email,
                applicantId: created.id,
                applicantName: input.name,
                applicantEmail: input.email,
                applicantPhone: input.phone,
                home,
                submittedAt: now.toISOString(),
                ...(input.home.kind === 'claim' && input.home.note !== undefined
                  ? { claimNote: input.home.note }
                  : {}),
              },
              meta.correlationId,
            ),
          ),
      );

      if (account === null) {
        // Two applications with one email raced past the pre-check; the unique index refused the
        // second. The answer is the same CONFLICT the pre-check gives — never a 500 (D-82).
        return errors.conflict('An application already exists for this email.');
      }

      return { ok: true, value: { personId: account.id } };
    },

    async requestPasswordReset(
      input: C.RequestPasswordResetInput,
      meta: RequestMeta,
    ): Promise<Result<null>> {
      const now = deps.env.clock.now();
      const limit = await deps.limiter.consume(
        `passwordReset:${input.email}`,
        C.RATE_LIMITS.passwordReset,
      );
      if (!limit.allowed) return errors.rateLimited(limit.retryAfterSeconds);

      const account = await deps.store.findAccountByEmail(input.email);
      if (account === null) {
        // Same result shape either way, at the same cost: the endpoint must not confirm which
        // addresses have accounts (D-22's lesson, kept). The reset email either arrives or the
        // address never existed; nothing distinguishes them to the caller.
        await dummyCompare(deps, 'not-a-real-password');
        return { ok: true, value: null };
      }

      const token = C.secretToken();
      const expiresAt = new Date(now.getTime() + C.PASSWORD_RESET_TTL_SECONDS * 1000);
      await deps.store.setResetToken(
        account.id,
        C.hashToken(token),
        expiresAt,
        [
          // The raw token goes only into the outbox row — internal to the database, read by the
          // mail worker, which builds the link from configuration so no resident is emailed a
          // localhost address (D-22).
          mailEvent(
            'password.reset_requested',
            {
              ...personPayload(account.name, account.email),
              recipientName: account.name,
              token,
              expiresAt: expiresAt.toISOString(),
            },
            meta.correlationId,
          ),
        ],
      );
      return { ok: true, value: null };
    },

    async completePasswordReset(input: C.CompletePasswordResetInput): Promise<Result<null>> {
      const now = deps.env.clock.now();
      const account = await deps.store.findAccountByResetTokenHash(C.hashToken(input.token));

      if (account === null) {
        // Not a bad password — a token that does not exist. No oracle on which is which.
        return errors.invalid('This reset link is not valid.');
      }

      if (account.resetExpiresAt === null || account.resetExpiresAt.getTime() <= now.getTime()) {
        // 15 minutes, single use, and the link dies with the reset (D-22).
        return errors.invalid('This reset link has expired. Request a new one.');
      }

      const passwordHash = await deps.hasher.hash(input.password);
      await deps.store.applyPasswordReset(account.id, passwordHash, now);
      return { ok: true, value: null };
    },

    async me(actor: Actor): Promise<Result<PersonView>> {
      const account = await deps.store.findAccountById(actor.userId);
      if (account === null) {
        return errors.unauthenticated();
      }
      // The actor was resolved against the live account moments ago; this re-read is the
      // per-request state check, so a disabling between the two is still caught (D-24).
      if (account.status !== 'ACTIVE') {
        return errors.stateNotAllowed('This account is not available. Please contact the office.');
      }
      return { ok: true, value: personView(account, await homeFor(deps, account)) };
    },

    async changePassword(
      actor: Actor,
      input: { currentPassword: string; newPassword: string },
    ): Promise<Result<null>> {
      const account = await deps.store.findAccountById(actor.userId);
      if (account === null) return errors.unauthenticated();

      const currentOk = await deps.hasher.compare(input.currentPassword, account.passwordHash);
      if (!currentOk) {
        return errors.invalid('Your current password is not right.', 'currentPassword');
      }

      // Passwords are validated at the boundary by contracts; this is the same policy applied
      // again at the seam, because the rule lives here if it lives anywhere (D-71).
      const policy = C.Password.safeParse(input.newPassword);
      if (!policy.success) {
        const first = policy.error.issues[0]?.message ?? 'Choose a stronger password.';
        return errors.invalid(first, 'newPassword');
      }

      const now = deps.env.clock.now();
      const passwordHash = await deps.hasher.hash(policy.data);
      // One transaction: the new hash, the new stamp, every refresh token revoked. A password
      // change kills every session, including the changer's own (D-23).
      await deps.store.applyPasswordChange(account.id, passwordHash, now);
      return { ok: true, value: null };
    },

    async pendingApplications(actor: Actor): Promise<Result<readonly ApplicationView[]>> {
      // Committee only, checked against the live account — a disabled administrator's token must
      // not read the queue either (D-24).
      const caller = await deps.store.findAccountById(actor.userId);
      if (caller === null) return errors.unauthenticated();
      if (caller.role !== 'A' || caller.status !== 'ACTIVE') {
        return errors.forbidden('review applications');
      }

      const pending = await deps.store.listPendingApplications();
      return {
        ok: true,
        value: pending.map((row) => ({
          userId: row.userId,
          name: row.name,
          email: row.email,
          phone: row.phone,
          appliedAt: row.appliedAt,
          // The applicant's words, exactly as given — resolved only at approval (D-04).
          claim:
            row.claim === null
              ? null
              : {
                  blockName: row.claim.blockName,
                  unitLabel: row.claim.unitLabel,
                  unitType: row.claim.unitType,
                  note: row.claim.note,
                },
        })),
      };
    },

    async decideRegistration(
      actor: Actor,
      input: C.DecideRegistrationInput,
      meta: RequestMeta,
    ): Promise<Result<PersonView>> {
      // Committee only, and only on live accounts — the same open handler could otherwise decide
      // with a disabled administrator's token (D-42, D-24).
      const caller = await deps.store.findAccountById(actor.userId);
      if (caller === null) return errors.unauthenticated();
      if (caller.role !== 'A' || caller.status !== 'ACTIVE') {
        return errors.forbidden('review applications');
      }

      const target = await deps.store.findAccountById(input.userId);
      if (target === null) return errors.notFound('application');
      if (target.role !== 'R') {
        // Staff accounts are provisioned by the office, not decided here (D-42).
        return errors.forbidden('review staff accounts');
      }

      const wanted = input.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
      if (!C.USER_TRANSITIONS[target.status].includes(wanted)) {
        // A permitted transition, not an assigned string (D-20's rule, for accounts).
        return errors.stateNotAllowed('This application cannot be decided now.');
      }

      let resolution: ClaimResolution | null = null;
      if (input.decision === 'APPROVE') {
        // Occupancy is re-checked at the moment of approval: others may have activated since the
        // application was filed. Counts ACTIVE residents only, so nothing pending holds a slot
        // (D-42).
        if (
          target.unitId !== null &&
          (await deps.store.countActiveResidentsForUnit(target.unitId)) >= C.MAX_OCCUPANTS_PER_UNIT
        ) {
          return errors.limitReached('That home is already full.');
        }

        const claim = await deps.store.findClaim(target.id);
        if (claim !== null) {
          const block = await deps.store.findBlockByName(claim.blockName);
          if (block !== null) {
            const unit = await deps.store.findUnitByLabel(block.id, claim.unitLabel);
            if (
              unit !== null &&
              (await deps.store.countActiveResidentsForUnit(unit.unitId)) >=
                C.MAX_OCCUPANTS_PER_UNIT
            ) {
              return errors.limitReached('That home is already full.');
            }
          }
          resolution = resolutionFrom(claim);
        }
      }

      // The home as the applicant reads it after the decision: the claimed address once the
      // claim resolves, the existing home they registered against, or the words of the claim
      // itself when the unit has to be created. A declined applicant reads their claim.
      let home = '';
      if (resolution !== null) {
        home = `${resolution.blockName} · ${resolution.unitLabel}`;
      } else if (target.unitId !== null) {
        const found = await deps.store.findHome(target.unitId);
        home = found === null ? '' : `${found.blockName} · ${found.label}`;
      } else {
        const claim = await deps.store.findClaim(target.id);
        home = claim === null ? '' : `${claim.blockName} · ${claim.unitLabel}`;
      }

      const account = await deps.store.applyRegistrationDecision(
        {
          userId: target.id,
          approve: input.decision === 'APPROVE',
          reason: input.reason ?? null,
          claim: resolution,
        },
        [
          mailEvent(
            input.decision === 'APPROVE' ? 'resident.approved' : 'resident.declined',
            {
              ...personPayload(target.name, target.email),
              recipientName: target.name,
              home,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
            },
            meta.correlationId,
          ),
        ],
      );

      if (account === null) {
        // Two committee members, one application: the other decision landed first. The row the
        // caller described no longer exists in the state they described it in.
        return errors.stateNotAllowed('This application was already decided.');
      }

      return { ok: true, value: personView(account, await homeFor(deps, account)) };
    },
  };
}
