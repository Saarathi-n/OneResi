import * as C from '@oneresi/contracts';
import type {
  RefreshToken,
  RegistrationClaim,
} from '../../prisma/generated/postgresql/index.js';
import type {
  AccountStore,
  ClaimResolution,
  StoredClaim,
  StoredRefreshToken,
} from '@oneresi/domain';
import type { Db } from '../client.js';
import { sharedLookups, toAccount, writeEvents } from './shared.js';
import type { Tx } from './shared.js';

/**
 * AccountStore over Prisma: registration, the committee's decision, password reset and change,
 * and refresh-token rotation. Each mutation runs in one transaction with the events that belong
 * to it (D-29); each guarded transition reports null rather than assigning (D-20's rule).
 */
export function accountStore(db: Db): AccountStore {
  const store: AccountStore = {
    ...sharedLookups(db),

    async findAccountByEmail(email) {
      const row = await db.residentUser.findUnique({ where: { email } });
      return row === null ? null : toAccount(row);
    },

    async findAccountById(id) {
      const row = await db.residentUser.findUnique({ where: { id } });
      return row === null ? null : toAccount(row);
    },

    /**
     * By the SHA-256 of the reset token. The column is unique — a hash points at one account by
     * construction, and null (cleared on use) never matches.
     */
    async findAccountByResetTokenHash(tokenHash) {
      const row = await db.residentUser.findUnique({ where: { resetTokenHash: tokenHash } });
      return row === null ? null : toAccount(row);
    },

    async countAccounts() {
      return db.residentUser.count();
    },

    /** ACTIVE committee members — the people an application is addressed to. */
    async findCommitteeMembers() {
      return db.residentUser.findMany({
        where: { role: 'A', status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { id: 'asc' },
      });
    },

    async createAccount(input, claim, eventsFor) {
      return db.$transaction(async (tx) => {
        const row = await tx.residentUser.create({
          data: {
            name: input.name,
            email: input.email,
            phone: input.phone,
            passwordHash: input.passwordHash,
            role: input.role,
            status: input.status,
            unitId: input.unitId,
            passwordChangedAt: input.passwordChangedAt,
          },
        });

        if (claim !== null) {
          // One live claim per account, upserted on userId: a registration creates a fresh
          // account so the create branch is the one that runs, but a claim arriving for an
          // account that already has one replaces the old row rather than colliding with the
          // unique index — the resubmission story the migration documents. The words are the
          // applicant's, stored exactly as given (D-04).
          await tx.registrationClaim.upsert({
            where: { userId: row.id },
            create: claimData(row.id, claim),
            update: { ...claimData(row.id, claim), resolvedUnitId: null, decidedById: null, resolvedAt: null },
          });
        }

        await writeEvents(tx, eventsFor(toAccount(row)));
        return toAccount(row);
      });
    },

    /**
     * The LIVE claim: still unresolved to a unit. Approval resolves it (null from then on); a
     * decline leaves the words readable — they are the audit of what the committee turned down,
     * and what a re-opened application (REJECTED -> PENDING) shows them again.
     */
    async findClaim(userId) {
      const row = await db.registrationClaim.findUnique({ where: { userId } });
      if (row === null || row.resolvedUnitId !== null) return null;
      return toClaim(row);
    },

    /**
     * The committee's queue: PENDING accounts oldest first, each with its live claim. The claim
     * join is on the account's side, so the queue is one query; a claim already resolved to a
     * unit reads as null, which is `findClaim`'s own rule applied to a list.
     */
    async listPendingApplications() {
      const rows = await db.residentUser.findMany({
        where: { status: 'PENDING' },
        include: { registrationClaims: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => {
        // One live claim per account by the unique index; the list is the findClaim rule at scale.
        const live = row.registrationClaims.find((claim) => claim.resolvedUnitId === null);
        return {
          userId: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          appliedAt: row.createdAt,
          claim: live === undefined ? null : toClaim(live),
        };
      });
    },

    async applyRegistrationDecision(input, events) {
      const wanted: C.UserStatus = input.approve ? 'ACTIVE' : 'REJECTED';
      // The store applies the caller's transition, it does not decide it — but the guard mirrors
      // the same machine the caller checked, so a decision that lost a race cannot also land.
      // Null is "the world changed", never an error.
      const sources = (Object.keys(C.USER_TRANSITIONS) as C.UserStatus[]).filter((status) =>
        C.USER_TRANSITIONS[status].includes(wanted),
      );
      // The port carries no clock, so the stamp is the moment of the transaction. Every other
      // mutation takes its timestamps from the caller; this one has nowhere to take them from.
      const decidedAt = new Date();

      return db.$transaction(async (tx) => {
        const applied = await tx.residentUser.updateMany({
          where: { id: input.userId, status: { in: sources } },
          data: { status: wanted },
        });
        if (applied.count === 0) return null;

        // The decision is stamped onto the claim's own row, never a replacement of it — the
        // applicant's words plus what became of them are the whole audit (D-04, D-47). Only now,
        // with the account claimed by this transaction, may the claim's home be resolved;
        // resolving before the guard would let a lost race commit a block for an application it
        // never decided.
        if (input.approve && input.claim !== null) {
          const unitId = await linkClaimHome(tx, input.userId, input.claim);
          await stampClaim(tx, input.userId, {
            resolvedUnitId: unitId,
            resolvedAt: decidedAt,
            ...(input.reason === null ? {} : { decisionReason: input.reason }),
          });
        } else {
          // A decline stamps the decision and nothing else: no unit, and the row survives —
          // REJECTED may become PENDING again, and the claim is what that re-opened application
          // shows the committee.
          await stampClaim(tx, input.userId, {
            resolvedAt: decidedAt,
            ...(input.reason === null ? {} : { decisionReason: input.reason }),
          });
        }
        // A claimless decision stores no reason: the port's own comment says those ride in the
        // mail event's variables, and inventing storage for them is not the adapter's call.

        await writeEvents(tx, events);
        const row = await tx.residentUser.findUnique({ where: { id: input.userId } });
        return row === null ? null : toAccount(row);
      });
    },

    async setResetToken(userId, tokenHash, expiresAt, events) {
      await db.$transaction(async (tx) => {
        await tx.residentUser.update({
          where: { id: userId },
          data: { resetTokenHash: tokenHash, resetExpiresAt: expiresAt },
        });
        await writeEvents(tx, events);
      });
    },

    /** One transaction: the hash, the stamp, every refresh token revoked, the token cleared. */
    async applyPasswordReset(userId, passwordHash, passwordChangedAt) {
      await db.$transaction(async (tx) => {
        await tx.residentUser.update({
          where: { id: userId },
          data: {
            passwordHash,
            passwordChangedAt,
            resetTokenHash: null,
            resetExpiresAt: null,
          },
        });
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: passwordChangedAt },
        });
      });
    },

    /** Same, without touching the reset token — the changer is already signed in. */
    async applyPasswordChange(userId, passwordHash, passwordChangedAt) {
      await db.$transaction(async (tx) => {
        await tx.residentUser.update({
          where: { id: userId },
          data: { passwordHash, passwordChangedAt },
        });
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: passwordChangedAt },
        });
      });
    },

    async createRefreshToken(input) {
      const row = await db.refreshToken.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          expiresAt: input.expiresAt,
          replacesId: input.replacesId,
          userAgent: input.userAgent,
        },
      });
      return toRefreshToken(row);
    },

    async findRefreshTokenByHash(tokenHash) {
      const row = await db.refreshToken.findUnique({ where: { tokenHash } });
      return row === null ? null : toRefreshToken(row);
    },

    async rotateRefreshToken(oldId, revokedAt, replacement) {
      return db.$transaction(async (tx) => {
        // Conditional revoke: only a live token rotates. A replay (already revoked) and a lost
        // race (revoked between the caller's read and here) both land here as null with nothing
        // changed — exactly the reuse signal the accounts service treats as fatal (D-24).
        const revoked = await tx.refreshToken.updateMany({
          where: { id: oldId, revokedAt: null },
          data: { revokedAt },
        });
        if (revoked.count === 0) return null;

        const row = await tx.refreshToken.create({
          data: {
            tokenHash: replacement.tokenHash,
            userId: replacement.userId,
            expiresAt: replacement.expiresAt,
            replacesId: replacement.replacesId,
            userAgent: replacement.userAgent,
          },
        });
        return toRefreshToken(row);
      });
    },

    async revokeRefreshFamily(tokenId, revokedAt) {
      await db.$transaction(async (tx) => {
        // Up to the root the sign-in created...
        const family = new Set<number>([tokenId]);
        let cursor = tokenId;
        for (;;) {
          const row = await tx.refreshToken.findUnique({
            where: { id: cursor },
            select: { replacesId: true },
          });
          const parent = row?.replacesId ?? null;
          if (parent === null || family.has(parent)) break;
          family.add(parent);
          cursor = parent;
        }

        // ...and down again through every descendant. Rotation makes a family a chain, but the
        // query follows children rather than assuming that, so a branch cannot survive (D-24).
        let frontier = [...family];
        while (frontier.length > 0) {
          const children = await tx.refreshToken.findMany({
            where: { replacesId: { in: frontier } },
            select: { id: true },
          });
          frontier = children.map((child) => child.id).filter((id) => !family.has(id));
          for (const id of frontier) family.add(id);
        }

        await tx.refreshToken.updateMany({
          where: { id: { in: [...family] }, revokedAt: null },
          data: { revokedAt },
        });
      });
    },

    async revokeAllRefreshTokens(userId, revokedAt) {
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      });
    },
  };

  return store;
}

function toRefreshToken(row: RefreshToken): StoredRefreshToken {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacesId: row.replacesId,
  };
}

function toClaim(row: RegistrationClaim): StoredClaim {
  return {
    blockName: row.blockName,
    unitLabel: row.unitLabel,
    unitType: row.unitType as C.UnitType,
    note: row.note,
  };
}

/** The claim's words, as the applicant gave them. Shared by the upsert's create and update. */
function claimData(userId: number, claim: StoredClaim) {
  return {
    userId,
    blockName: claim.blockName,
    unitLabel: claim.unitLabel,
    unitType: claim.unitType,
    note: claim.note,
  };
}

/**
 * Stamps the decision onto the claim row. `updateMany` because the account may have no claim at
 * all (a claimless decision), and that is a no-op, not an error — count 0 is simply "nothing to
 * stamp". The row itself is never deleted, here or anywhere.
 */
async function stampClaim(
  tx: Tx,
  userId: number,
  stamps: { resolvedUnitId?: number; resolvedAt: Date; decisionReason?: string },
): Promise<void> {
  await tx.registrationClaim.updateMany({ where: { userId }, data: stamps });
}

/**
 * Find-or-create the block, find-or-create the unit, link the account — and say which unit the
 * claim became. The charge arrives from the caller (zero until an administrator sets it — an
 * applicant never sets a charge, D-04).
 */
async function linkClaimHome(
  tx: Tx,
  userId: number,
  claim: ClaimResolution,
): Promise<number> {
  const block =
    (await tx.block.findUnique({ where: { name: claim.blockName } })) ??
    (await tx.block.create({ data: { name: claim.blockName, floors: 1 } }));
  const unit =
    (await tx.unit.findUnique({
      where: { blockId_label: { blockId: block.id, label: claim.unitLabel } },
    })) ??
    (await tx.unit.create({
      data: {
        blockId: block.id,
        label: claim.unitLabel,
        type: claim.unitType,
        monthlyChargePaise: claim.monthlyChargePaise,
      },
    }));
  await tx.residentUser.update({ where: { id: userId }, data: { unitId: unit.id } });
  return unit.id;
}
