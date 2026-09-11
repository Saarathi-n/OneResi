#!/usr/bin/env node
/**
 * The end-to-end walk of the whole system, over real HTTP against the real server and the real
 * database. The suites under packages/ prove each service and each store in isolation; this
 * script proves the wiring: every route, every contract, the outbox, the worker, the cookie, and
 * the role rules — the things only a running system can show.
 *
 * It is written to run ONCE against a FRESH seed, in order, and says so if it does not get one:
 *   pnpm db:reset && pnpm db:seed
 *   APP_ORIGIN=http://localhost:3000 pnpm --filter @oneresi/web dev   # another terminal
 *   node scripts/e2e-local.mjs
 *
 * The APP_ORIGIN export matters: without it the outbox's mail rows sit PENDING with
 * MailConfigError and the password-reset step cannot find its rendered link.
 *
 * What it needs and why:
 *   - the three seeded sign-ins (committee, gate, one resident) — the fixed seed password,
 *     overridable with SEED_PASSWORD;
 *   - read access to the SQLite file (default .data/oneresi.db, overridable with LOCAL_DB_FILE)
 *     for exactly two things no HTTP response can show: the rendered password-reset link, and
 *     the outbox row behind it. Reads are opened read-only per query and retried on a busy lock.
 *
 * Every check prints pass or FAIL with its detail, grouped by feature; the exit code is 1 if
 * anything failed. Nothing here mutates anything outside the local database the server already
 * owns.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const DB_FILE = join(repoRoot, process.env.LOCAL_DB_FILE ?? '.data/oneresi.db');
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'starling-marble-97-QUAY';

const COMMITTEE = 'committee@oneresi.in';
const GATE = 'gate@oneresi.in';
const RESIDENT = 'saarathi@oneresi.in';
/** The account this run registers, approves, re-passwords and reset-tests. Fixed: one run per fresh seed. */
const E2E_EMAIL = 'e2e.walker@oneresi.example';
const E2E_PASSWORD = 'Trail-Map-4821';
const E2E_REPASSWORD = 'Harbor-Lamp-9073';
const E2E_RESET_PASSWORD = 'Cedar-Ridge-5562';

// ---------------------------------------------------------------- reporting

let passed = 0;
let failed = 0;

function begin(name) {
  console.log(`\n${name}`);
}

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  pass  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

// ---------------------------------------------------------------- the client

/** One signed-in identity: an access token in memory and the refresh cookie beside it. */
function makeActor() {
  return { token: null, cookie: null };
}

async function api(actor, method, path, { json, query } = {}) {
  const url = new URL(BASE_URL + path);
  if (query !== undefined) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = {};
  if (actor?.token) headers.authorization = `Bearer ${actor.token}`;
  if (actor?.cookie) headers.cookie = actor.cookie;
  if (json !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    redirect: 'manual',
  });
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';')[0];
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // Sign-out clears the cookie (maxAge=0); a real jar would drop it, and so do we.
    if (actor) actor.cookie = value === '' ? null : `${name}=${value}`;
  }
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

async function signIn(email, password) {
  const actor = makeActor();
  const r = await api(actor, 'POST', '/api/auth/sign-in', { json: { email, password } });
  if (r.status === 200 && r.body?.accessToken) {
    actor.token = r.body.accessToken;
    actor.person = r.body.person;
  }
  return { actor, r };
}

/** Poll until fn returns non-undefined, or give up after attempts. */
async function poll(fn, { attempts = 12, intervalMs = 2500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((wake) => setTimeout(wake, intervalMs));
  }
  return undefined;
}

// ---------------------------------------------------------------- the database

/**
 * Read-only peek at the local SQLite file, retried on a busy lock — the dev server owns the
 * writes; this never asks for more than a shared read, and never holds the handle.
 */
function dbAll(sql, params = []) {
  for (let i = 0; i < 5; i += 1) {
    let db;
    try {
      db = new DatabaseSync(DB_FILE, { readOnly: true });
      return db.prepare(sql).all(...params);
    } catch (error) {
      const busy = /busy|locked/i.test(String(error));
      if (i === 4 || !busy) throw error;
    } finally {
      try {
        db?.close();
      } catch {
        /* already closed */
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------- dates

const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(now);
const TOMORROW = iso(new Date(now.getTime() + 24 * 60 * 60 * 1000));
const NEXT_PERIOD = `${now.getUTCFullYear()}-${String(((now.getUTCMonth() + 1) % 12) + 1).padStart(2, '0')}`;

// ================================================================ the walk

async function main() {
  console.log(`end-to-end walk — ${BASE_URL} — ${TODAY}`);

  // ---------------------------------------------------------------- server up
  begin('server');
  const up = await poll(async () => {
    try {
      const r = await api(null, 'GET', '/api/registration/options');
      return r.status === 200 ? true : undefined;
    } catch {
      return undefined;
    }
  }, { attempts: 30, intervalMs: 2000 });
  check('API server is up and answering', up === true, `nothing answered at ${BASE_URL}/api/registration/options`);
  if (up !== true) process.exit(1);

  check(
    'the seed is fresh (the e2e account cannot sign in yet)',
    (await api(makeActor(), 'POST', '/api/auth/sign-in', { json: { email: E2E_EMAIL, password: E2E_PASSWORD } })).status !== 200,
    'run `pnpm db:reset && pnpm db:seed` first — this walk runs once per fresh seed',
  );

  // ---------------------------------------------------------------- sign in the three
  begin('sign-in — the three seeded accounts');
  const committee = makeActor();
  const gate = makeActor();
  const resident = makeActor();
  const sessions = await Promise.all([
    signIn(COMMITTEE, SEED_PASSWORD),
    signIn(GATE, SEED_PASSWORD),
    signIn(RESIDENT, SEED_PASSWORD),
  ]);
  check('committee signs in', sessions[0].r.status === 200 && sessions[0].actor.person?.role === 'A', JSON.stringify(sessions[0].r.body)?.slice(0, 120));
  check('gate signs in', sessions[1].r.status === 200 && sessions[1].actor.person?.role === 'S', JSON.stringify(sessions[1].r.body)?.slice(0, 120));
  check('resident signs in with a home', sessions[2].r.status === 200 && sessions[2].actor.person?.home?.unitId > 0, JSON.stringify(sessions[2].r.body)?.slice(0, 120));
  committee.token = sessions[0].actor.token;
  gate.token = sessions[1].actor.token;
  resident.token = sessions[2].actor.token;
  const unitId = sessions[2].actor.person?.home?.unitId;

  check('refresh cookie is set and refreshes', await (async () => {
    const a = makeActor();
    const first = await api(a, 'POST', '/api/auth/sign-in', { json: { email: RESIDENT, password: SEED_PASSWORD } });
    if (first.status !== 200 || a.cookie === null) return `sign-in status ${first.status}, cookie ${a.cookie}`;
    const refreshed = await api(a, 'POST', '/api/auth/refresh');
    if (refreshed.status !== 200 || typeof refreshed.body?.accessToken !== 'string') return `refresh status ${refreshed.status}`;
    a.token = refreshed.body.accessToken;
    const me = await api(a, 'GET', '/api/auth/me');
    return me.status === 200 && me.body?.email === RESIDENT ? true : `me after refresh: ${me.status}`;
  })());
  check('sign-out clears the session', (await (async () => {
    const a = makeActor();
    await api(a, 'POST', '/api/auth/sign-in', { json: { email: RESIDENT, password: SEED_PASSWORD } });
    await api(a, 'POST', '/api/auth/sign-out');
    const after = await api(a, 'POST', '/api/auth/refresh');
    return after.status === 401 ? true : `refresh after sign-out answered ${after.status}`;
  })()) === true);

  // ---------------------------------------------------------------- auth negatives
  begin('auth — the refusals');
  const wrong = await api(makeActor(), 'POST', '/api/auth/sign-in', { json: { email: E2E_EMAIL, password: 'Not-The-Password-1' } });
  check('wrong password is a 401 with the error shape', wrong.status === 401 && wrong.body?.code === 'UNAUTHENTICATED', JSON.stringify(wrong.body));
  const noToken = await api(makeActor(), 'GET', '/api/notifications');
  check('no bearer token is a 401', noToken.status === 401, `status ${noToken.status}`);
  const badBody = await api(resident, 'POST', '/api/auth/sign-in', { json: { email: 'not-an-email', password: '' } });
  check('a contract failure is a 400 naming the fields', badBody.status === 400 && badBody.body?.code === 'INVALID_INPUT' && Array.isArray(badBody.body?.fields), JSON.stringify(badBody.body));

  // ---------------------------------------------------------------- registration → approval → sign-in
  begin('registration — apply, review, approve, first sign-in');
  const options = await api(null, 'GET', '/api/registration/options');
  check('registration options are public and list blocks with units', options.status === 200 && options.body?.length >= 3 && options.body[0]?.units?.length > 0, `body ${JSON.stringify(options.body)?.slice(0, 120)}`);
  const registered = await api(null, 'POST', '/api/auth/register', {
    json: {
      name: 'E2E Walker',
      email: E2E_EMAIL,
      phone: '+919876543210',
      password: E2E_PASSWORD,
      home: { kind: 'claim', blockName: 'E2E Wing', unitLabel: 'e2e-01', unitType: 'FLAT_2BHK', note: 'Registered by the end-to-end walk.' },
    },
  });
  check('a public registration is accepted and queues as PENDING', registered.status === 200, JSON.stringify(registered.body)?.slice(0, 160));

  const queue = await api(committee, 'GET', '/api/applications');
  const mine = (queue.body ?? []).find((a) => a.email === E2E_EMAIL);
  const seededPending = (queue.body ?? []).find((a) => a.email === 'kabir.chowdhury@gmail.com');
  check('the committee queue shows the application (and the seeded pending one)', queue.status === 200 && mine !== undefined && seededPending !== undefined, `queue length ${(queue.body ?? []).length}`);
  check('the claim travelled with it', mine?.claim?.blockName === 'E2E Wing' && mine?.claim?.unitLabel === 'E2E-01', JSON.stringify(mine?.claim));

  const approved = await api(committee, 'POST', '/api/applications/decision', { json: { userId: mine.userId, decision: 'APPROVE' } });
  check('the committee approves the claim', approved.status === 200, JSON.stringify(approved.body));
  const firstSignIn = await signIn(E2E_EMAIL, E2E_PASSWORD);
  check(
    'the approved resident signs in with the claimed home',
    firstSignIn.r.status === 200 && firstSignIn.actor.person?.status === 'ACTIVE' && firstSignIn.actor.person?.home?.blockName === 'E2E Wing' && firstSignIn.actor.person?.home?.label === 'E2E-01',
    JSON.stringify(firstSignIn.r.body)?.slice(0, 200),
  );
  const declined = await api(committee, 'POST', '/api/applications/decision', { json: { userId: seededPending.userId, decision: 'DECLINE', reason: 'The flat already has a registered household.' } });
  check('the committee declines the other seeded application', declined.status === 200, JSON.stringify(declined.body));
  const declinedSignIn = await api(makeActor(), 'POST', '/api/auth/sign-in', { json: { email: 'kabir.chowdhury@gmail.com', password: SEED_PASSWORD } });
  check('a declined applicant cannot sign in', declinedSignIn.status === 409 && declinedSignIn.body?.code === 'STATE_NOT_ALLOWED', `status ${declinedSignIn.status}`);
  const e2e = firstSignIn.actor;

  // ---------------------------------------------------------------- change password + reset
  begin('passwords — change, then a full reset through the outbox');
  const changed = await api(e2e, 'POST', '/api/auth/change-password', { json: { currentPassword: E2E_PASSWORD, newPassword: E2E_REPASSWORD } });
  check('change-password accepts the current password', changed.status === 200, JSON.stringify(changed.body));
  const oldAfterChange = await api(makeActor(), 'POST', '/api/auth/sign-in', { json: { email: E2E_EMAIL, password: E2E_PASSWORD } });
  check('the old password stops working', oldAfterChange.status === 401, `status ${oldAfterChange.status}`);

  const resetRequested = await api(null, 'POST', '/api/auth/password/reset-request', { json: { email: E2E_EMAIL } });
  check('reset-request is accepted (it never says whether the account exists)', resetRequested.status === 200, JSON.stringify(resetRequested.body));
  const resetMail = await poll(() => {
    const rows = dbAll(
      "SELECT \"bodyHtml\" FROM mail_message WHERE \"toAddress\" = ? AND template = 'password.reset_requested' AND status = 'SENT' ORDER BY id DESC LIMIT 1",
      [E2E_EMAIL],
    );
    const link = rows[0]?.bodyHtml?.match(/token=([A-Za-z0-9._-]+)/);
    return link === null || link === undefined ? undefined : link[1];
  });
  check('the outbox worker rendered and sent the reset mail', resetMail !== undefined, 'no SENT password-reset row for the address — is APP_ORIGIN set on the server?');
  if (resetMail === undefined) {
    check('reset completes with the mailed token', false, 'skipped: no token');
  } else {
    const resetDone = await api(null, 'POST', '/api/auth/password/reset-complete', { json: { token: resetMail, password: E2E_RESET_PASSWORD } });
    check('reset completes with the mailed token', resetDone.status === 200, JSON.stringify(resetDone.body));
    const reSignIn = await signIn(E2E_EMAIL, E2E_RESET_PASSWORD);
    check('the new password signs in', reSignIn.r.status === 200, `status ${reSignIn.r.status}`);
    const tokenAgain = await api(null, 'POST', '/api/auth/password/reset-complete', { json: { token: resetMail, password: 'Another-Pass-7770' } });
    check('the token is single-use', tokenAgain.status >= 400, `status ${tokenAgain.status}`);
  }

  // ---------------------------------------------------------------- property (committee)
  begin('property — the register the committee keeps');
  const newBlock = await api(committee, 'POST', '/api/property/blocks', { json: { name: 'E2E Court', floors: 2 } });
  check('the committee creates a block', newBlock.status === 200 && newBlock.body?.id > 0, JSON.stringify(newBlock.body)?.slice(0, 120));
  const newUnit = await api(committee, 'POST', '/api/property/units', { json: { blockId: newBlock.body.id, unitLabel: 'e2e-901', type: 'FLAT_2BHK', monthlyChargePaise: 250000 } });
  check('the committee creates a unit in it', newUnit.status === 200 && newUnit.body?.id > 0, JSON.stringify(newUnit.body)?.slice(0, 120));
  const patched = await api(committee, 'PATCH', `/api/property/units/${newUnit.body.id}`, { json: { unitId: newUnit.body.id, monthlyChargePaise: 260000 } });
  check('the committee updates the monthly charge', patched.status === 200, JSON.stringify(patched.body)?.slice(0, 120));
  const optionsAfter = await api(null, 'GET', '/api/registration/options');
  const e2eBlock = (optionsAfter.body ?? []).find((b) => b.blockName === 'E2E Court');
  check('a fresh registration can now claim the new unit', e2eBlock?.units?.some((u) => u.label === 'E2E-901'), JSON.stringify(e2eBlock)?.slice(0, 120));
  const residentBlocks = await api(resident, 'GET', '/api/property/blocks');
  check('the property list is committee-only', residentBlocks.status === 403, `status ${residentBlocks.status}`);

  // ---------------------------------------------------------------- billing
  begin('billing — a period raised, paid, recorded, cancelled');
  const dueDate = iso(new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000));
  const raised = await api(committee, 'POST', '/api/billing/invoices', { json: { period: NEXT_PERIOD, dueDate } });
  check(`the committee raises invoices for ${NEXT_PERIOD}`, raised.status === 200, JSON.stringify(raised.body)?.slice(0, 160));
  const raisedAgain = await api(committee, 'POST', '/api/billing/invoices', { json: { period: NEXT_PERIOD, dueDate } });
  check('raising the same period twice is refused', raisedAgain.status === 409, `status ${raisedAgain.status}`);

  const society = await api(committee, 'GET', '/api/billing/invoices/society');
  const periodInvoices = (society.body ?? []).filter((i) => i.period === NEXT_PERIOD && i.status === 'UNPAID');
  check('the society list shows the new period, home-named', society.status === 200 && periodInvoices.length >= 3, `${periodInvoices.length} unpaid invoices in ${NEXT_PERIOD}`);

  const household = await api(resident, 'GET', '/api/billing/invoices');
  const mine2 = (household.body ?? []).find((i) => i.period === NEXT_PERIOD);
  check('the resident sees their own invoice for the period', household.status === 200 && mine2 !== undefined, JSON.stringify(household.body)?.slice(0, 160));

  const idemKey = 'a'.repeat(32);
  const paid = await api(resident, 'POST', `/api/billing/invoices/${mine2.id}/pay`, { json: { invoiceId: mine2.id, method: 'UPI', idempotencyKey: idemKey } });
  check('paying returns a numbered receipt', paid.status === 200 && typeof paid.body?.receiptNo === 'string' && paid.body.receiptNo.length > 0, JSON.stringify(paid.body)?.slice(0, 160));
  const paidAgain = await api(resident, 'POST', `/api/billing/invoices/${mine2.id}/pay`, { json: { invoiceId: mine2.id, method: 'UPI', idempotencyKey: idemKey } });
  check('the same idempotency key returns the same receipt, not a second payment', paidAgain.status === 200 && paidAgain.body?.receiptNo === paid.body?.receiptNo, JSON.stringify(paidAgain.body)?.slice(0, 120));
  const paidBare = await api(resident, 'POST', `/api/billing/invoices/${mine2.id}/pay`, { json: { invoiceId: mine2.id, method: 'UPI' } });
  check('paying a paid invoice without a key is a 409', paidBare.status === 409, `status ${paidBare.status}`);

  const receipt = await api(resident, 'GET', `/api/billing/receipts/${encodeURIComponent(paid.body.receiptNo)}`);
  check('the receipt reads back by number', receipt.status === 200 && receipt.body?.receiptNo === paid.body.receiptNo, JSON.stringify(receipt.body)?.slice(0, 120));

  const offlineTarget = periodInvoices.find((i) => i.home?.unitId !== unitId);
  const offline = await api(committee, 'POST', `/api/billing/invoices/${offlineTarget.id}/offline-payment`, { json: { invoiceId: offlineTarget.id, amountPaise: offlineTarget.amountPaise, method: 'CASH', receivedOn: TODAY, note: 'Collected at the desk.' } });
  check('the committee records a cash payment with its own receipt', offline.status === 200 && typeof offline.body?.receiptNo === 'string', JSON.stringify(offline.body)?.slice(0, 160));

  const cancelTarget = periodInvoices.find((i) => i.id !== mine2.id && i.id !== offlineTarget.id);
  const cancelled = await api(committee, 'POST', `/api/billing/invoices/${cancelTarget.id}/cancel`, { json: { invoiceId: cancelTarget.id, reason: 'Raised twice for the same flat by mistake.' } });
  check('the committee cancels an invoice with a reason', cancelled.status === 200, JSON.stringify(cancelled.body)?.slice(0, 120));
  const residentSociety = await api(resident, 'GET', '/api/billing/invoices/society');
  check('the society ledger is committee-only', residentSociety.status === 403, `status ${residentSociety.status}`);

  // ---------------------------------------------------------------- complaints
  begin('complaints — raise, work, resolve, reopen');
  const complaint = await api(resident, 'POST', '/api/complaints', { json: { category: 'PLUMBING', priority: 'HIGH', description: 'The kitchen tap has been dripping steadily since yesterday evening.' } });
  check('a resident raises a complaint', complaint.status === 200 && complaint.body?.id > 0, JSON.stringify(complaint.body)?.slice(0, 160));
  const societyComplaints = await api(committee, 'GET', '/api/complaints/society', { query: { status: 'OPEN' } });
  check('the committee sees it in the open queue', societyComplaints.status === 200 && (societyComplaints.body ?? []).some((c) => c.id === complaint.body.id), `open queue ${(societyComplaints.body ?? []).length}`);
  const inProgress = await api(committee, 'POST', `/api/complaints/${complaint.body.id}/updates`, { json: { complaintId: complaint.body.id, status: 'IN_PROGRESS', note: 'Plumber visits tomorrow morning.' } });
  check('the committee moves it to in-progress with a note', inProgress.status === 200, JSON.stringify(inProgress.body)?.slice(0, 120));
  const resolved = await api(committee, 'POST', `/api/complaints/${complaint.body.id}/updates`, { json: { complaintId: complaint.body.id, status: 'RESOLVED', note: 'Washer replaced; drip stopped.' } });
  check('the committee resolves it', resolved.status === 200, JSON.stringify(resolved.body)?.slice(0, 120));
  const reopened = await api(resident, 'POST', `/api/complaints/${complaint.body.id}/reopen`, { json: { complaintId: complaint.body.id, reason: 'The drip came back the same night; the washer did not hold.' } });
  check('the resident reopens it inside the window', reopened.status === 200, JSON.stringify(reopened.body)?.slice(0, 120));
  const trail = await api(resident, 'GET', '/api/complaints');
  const withTrail = (trail.body ?? []).find((c) => c.id === complaint.body.id);
  check('the household list shows the whole trail', withTrail?.updates?.length >= 3, `${withTrail?.updates?.length ?? 0} updates`);
  const residentUpdate = await api(resident, 'POST', `/api/complaints/${complaint.body.id}/updates`, { json: { complaintId: complaint.body.id, status: 'CLOSED', note: 'Should not be allowed.' } });
  check('a resident cannot work the queue', residentUpdate.status === 403, `status ${residentUpdate.status}`);

  // ---------------------------------------------------------------- facilities
  begin('facilities — availability, booking, the double-book wall');
  const facilities = await api(resident, 'GET', '/api/facilities');
  check('the facility list is signed-in', facilities.status === 200 && (facilities.body ?? []).length >= 5, `${(facilities.body ?? []).length} facilities`);
  const availability = await api(resident, 'GET', `/api/facilities/${facilities.body[0].id}/availability`, { query: { on: TOMORROW } });
  const freeSlots = (availability.body ?? []).filter((s) => s.available);
  check('availability lists bookable slots for tomorrow', availability.status === 200 && freeSlots.length >= 3, `${freeSlots.length} free slots`);

  const [slotA, slotB, slotC] = freeSlots;
  const booked = await api(resident, 'POST', '/api/facilities/bookings', { json: { facilityId: facilities.body[0].id, bookingDate: TOMORROW, startTime: slotA.startTime, endTime: slotA.endTime } });
  check('a resident books a slot', booked.status === 200 && booked.body?.id > 0, JSON.stringify(booked.body)?.slice(0, 160));
  const doubleBooked = await api(resident, 'POST', '/api/facilities/bookings', { json: { facilityId: facilities.body[0].id, bookingDate: TOMORROW, startTime: slotA.startTime, endTime: slotA.endTime } });
  check('the same slot cannot be booked twice', doubleBooked.status === 409, `status ${doubleBooked.status}`);
  const availabilityAfter = await api(resident, 'GET', `/api/facilities/${facilities.body[0].id}/availability`, { query: { on: TOMORROW } });
  const slotAfter = (availabilityAfter.body ?? []).find((s) => s.startTime === slotA.startTime);
  check('the slot now shows as held', slotAfter?.available === false, JSON.stringify(slotAfter));

  const confirmed = await api(committee, 'POST', `/api/facilities/bookings/${booked.body.id}/decision`, { json: { bookingId: booked.body.id, decision: 'CONFIRM' } });
  check('the committee confirms the booking', confirmed.status === 200, JSON.stringify(confirmed.body)?.slice(0, 120));
  const booked2 = await api(resident, 'POST', '/api/facilities/bookings', { json: { facilityId: facilities.body[0].id, bookingDate: TOMORROW, startTime: slotB.startTime, endTime: slotB.endTime } });
  const rejected = await api(committee, 'POST', `/api/facilities/bookings/${booked2.body.id}/decision`, { json: { bookingId: booked2.body.id, decision: 'REJECT', reason: 'Deep maintenance that morning.' } });
  check('the committee can reject with a reason', rejected.status === 200, JSON.stringify(rejected.body)?.slice(0, 120));
  const booked3 = await api(resident, 'POST', '/api/facilities/bookings', { json: { facilityId: facilities.body[0].id, bookingDate: TOMORROW, startTime: slotC.startTime, endTime: slotC.endTime } });
  const cancelledBooking = await api(resident, 'POST', `/api/facilities/bookings/${booked3.body.id}/cancel`, { json: { bookingId: booked3.body.id } });
  check('the resident cancels their own booking', cancelledBooking.status === 200, JSON.stringify(cancelledBooking.body)?.slice(0, 120));
  const societyBookings = await api(committee, 'GET', '/api/facilities/bookings/society');
  check('the committee sees the society calendar', societyBookings.status === 200 && (societyBookings.body ?? []).length >= 8, `${(societyBookings.body ?? []).length} bookings`);

  // ---------------------------------------------------------------- visitors and the gate
  begin('visitors — a pass, the gate, and the walk-in loop');
  const pass = await api(resident, 'POST', '/api/visitors/passes', { json: { visitorName: 'Ravi Menon', purpose: 'Family lunch', validDate: TODAY } });
  check('a resident issues a pass with a six-digit code', pass.status === 200 && /^\d{6}$/.test(pass.body?.code ?? ''), JSON.stringify(pass.body)?.slice(0, 160));
  const expected = await api(resident, 'GET', '/api/visitors/expected-today');
  check('the pass is on today\'s list', (expected.body ?? []).some((p) => p.id === pass.body.id), `${(expected.body ?? []).length} expected`);

  const notification = await poll(async () => {
    const r = await api(resident, 'GET', '/api/notifications');
    const item = (r.body?.items ?? []).find((n) => n.title === 'Visitor pass ready');
    return item === undefined ? undefined : { r, item };
  });
  check('the in-app notification arrived through the worker', notification !== undefined, 'no "Visitor pass ready" notification within 30s');
  if (notification !== undefined) {
    const read = await api(resident, 'POST', '/api/notifications/read', { json: { ids: [notification.item.id] } });
    const after = await api(resident, 'GET', '/api/notifications');
    const stillThere = (after.body?.items ?? []).find((n) => n.id === notification.item.id);
    check('marking read drops the unread count', read.status === 200 && stillThere?.read === true, JSON.stringify(after.body?.count));
  }

  const verified = await api(gate, 'POST', '/api/gate/verify', { json: { code: pass.body.code } });
  check(
    'the gate verifies the code and is told where to send the visitor',
    verified.status === 200 && verified.body?.verdict === 'ADMIT' && typeof verified.body?.destination === 'string',
    JSON.stringify(verified.body)?.slice(0, 160),
  );
  const badCode = await api(gate, 'POST', '/api/gate/verify', { json: { code: '000001' } });
  check('an unknown code is refused, not an error', badCode.status === 200 && badCode.body?.verdict === 'REFUSE', JSON.stringify(badCode.body)?.slice(0, 120));

  const checkedIn = await api(gate, 'POST', '/api/gate/entry', { json: { passId: pass.body.id, action: 'CHECK_IN' } });
  check('the gate records the check-in', checkedIn.status === 200, JSON.stringify(checkedIn.body)?.slice(0, 120));
  const checkedOut = await api(gate, 'POST', '/api/gate/entry', { json: { passId: pass.body.id, action: 'CHECK_OUT' } });
  check('and the check-out', checkedOut.status === 200, JSON.stringify(checkedOut.body)?.slice(0, 120));
  const reused = await api(gate, 'POST', '/api/gate/verify', { json: { code: pass.body.code } });
  check('a used pass does not admit twice', reused.status === 200 && reused.body?.verdict === 'REFUSE', JSON.stringify(reused.body)?.slice(0, 120));

  const pass2 = await api(resident, 'POST', '/api/visitors/passes', { json: { visitorName: 'Deepa Rao', purpose: 'Delivering a parcel', validDate: TODAY } });
  const passCancelled = await api(resident, `POST`, `/api/visitors/passes/${pass2.body.id}/cancel`);
  check('the resident cancels an unused pass', passCancelled.status === 200, JSON.stringify(passCancelled.body)?.slice(0, 120));

  // The walk-in loop: gate logs, resident decides, both lists agree.
  const walkIn = await api(gate, 'POST', '/api/gate/walk-ins', { json: { unitId, visitorName: 'Meera Nair', phone: '+919812345678', purpose: 'Flower delivery' } });
  check('the gate logs a walk-in at the flat', walkIn.status === 200 && walkIn.body?.logId > 0, JSON.stringify(walkIn.body)?.slice(0, 160));
  const residentWaiting = await api(resident, 'GET', '/api/visitors/waiting');
  const gateWaiting = await api(gate, 'GET', '/api/visitors/waiting');
  check('the resident sees the visitor waiting on them', (residentWaiting.body ?? []).some((w) => w.name === 'Meera Nair'), `${(residentWaiting.body ?? []).length} waiting`);
  check('the gate sees the same queue society-wide, home-named', (gateWaiting.body ?? []).some((w) => w.name === 'Meera Nair' && typeof w.homeLabel === 'string' && w.homeLabel.length > 0), JSON.stringify(gateWaiting.body?.[0]));
  const decided = await api(resident, 'POST', `/api/visitors/walk-ins/${walkIn.body.logId}/decision`, { json: { logId: walkIn.body.logId, decision: 'APPROVE' } });
  check('the resident approves from their phone', decided.status === 200, JSON.stringify(decided.body)?.slice(0, 120));
  const waitingAfter = await api(gate, 'GET', '/api/visitors/waiting');
  check('the queue no longer holds them', !(waitingAfter.body ?? []).some((w) => w.name === 'Meera Nair'), JSON.stringify(waitingAfter.body)?.slice(0, 120));

  const override = await api(gate, 'POST', '/api/gate/walk-ins', { json: { unitId, visitorName: 'Arun Kumar', purpose: 'Water tanker', guardOverride: { reason: 'Tanker cannot wait; resident reached by phone.' } } });
  check('a guard override names itself and is accepted', override.status === 200, JSON.stringify(override.body)?.slice(0, 160));
  const entries = await api(resident, 'GET', '/api/visitors/entries');
  const overrideRow = (entries.body ?? []).find((e) => e.visitorName === 'Arun Kumar');
  check('the override shows in the household log as already decided', overrideRow !== undefined && overrideRow.approvalStatus !== 'PENDING', JSON.stringify(overrideRow)?.slice(0, 160));
  // The live feed is an SSE stream — never read its body, only its head, then close it.
  const live = await fetch(`${BASE_URL}/api/gate/live`, {
    headers: { authorization: `Bearer ${gate.token}` },
    signal: AbortSignal.timeout(8000),
  });
  const liveType = live.headers.get('content-type') ?? '';
  await live.body?.cancel().catch(() => {});
  check('the gate live feed streams', live.status === 200 && liveType.includes('text/event-stream'), `status ${live.status} type ${liveType}`);

  // ---------------------------------------------------------------- notices
  begin('notices — publish, pin, withdraw');
  const notice = await api(committee, 'POST', '/api/notices', { json: { title: 'Water tank cleaning', body: 'The overhead tanks are cleaned on Sunday morning; expect the supply to stop between 9 and 11.', category: 'MAINTENANCE', pinned: true } });
  check('the committee publishes a pinned notice', notice.status === 200 && notice.body?.id > 0, JSON.stringify(notice.body)?.slice(0, 160));
  const feed = await api(resident, 'GET', '/api/notices');
  const feedItem = (feed.body ?? []).find((n) => n.id === notice.body.id);
  check('the feed shows it to every resident', feedItem !== undefined && feedItem.pinned === true, JSON.stringify(feed.body?.[0])?.slice(0, 120));
  const withdrawn = await api(committee, 'DELETE', `/api/notices/${notice.body.id}`);
  check('the committee withdraws it', withdrawn.status === 200, `status ${withdrawn.status}`);
  const feedAfter = await api(resident, 'GET', '/api/notices');
  check('a withdrawn notice is gone from the feed', !(feedAfter.body ?? []).some((n) => n.id === notice.body.id), '');
  const gatePublish = await api(gate, 'POST', '/api/notices', { json: { title: 'Not the gate\'s job', body: 'The kiosk must never be able to publish a notice.', category: 'GENERAL' } });
  check('the gate cannot publish', gatePublish.status === 403, `status ${gatePublish.status}`);

  // ---------------------------------------------------------------- push subscriptions (when wired)
  begin('push — subscriptions, when the routes exist');
  const pushKey = await api(resident, 'GET', '/api/push/key');
  if (pushKey.status === 404) {
    console.log('  note  no push routes on this build — skipped');
  } else {
    check('the public key route answers', pushKey.status === 200, JSON.stringify(pushKey.body)?.slice(0, 120));
    const subscribed = await api(resident, 'POST', '/api/push/subscribe', {
      json: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-walk-subscription',
        keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
      },
    });
    check('a subscription is stored for the caller', subscribed.status === 200, JSON.stringify(subscribed.body)?.slice(0, 120));
    const unsubscribed = await api(resident, 'POST', '/api/push/unsubscribe', { json: { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-walk-subscription' } });
    check('and retired by its endpoint', unsubscribed.status === 200, JSON.stringify(unsubscribed.body)?.slice(0, 120));
  }

  // ---------------------------------------------------------------- the role matrix
  begin('authorization — every role gets only its own surface');
  const matrix = [
    ['resident reads the society ledger', resident, 'GET', '/api/billing/invoices/society'],
    ['resident reads the application queue', resident, 'GET', '/api/applications'],
    ['resident verifies a gate code', resident, 'POST', '/api/gate/verify', { code: '123456' }],
    ['gate reads a household ledger', gate, 'GET', '/api/billing/invoices'],
    ['gate issues a visitor pass', gate, 'POST', '/api/visitors/passes', { visitorName: 'No One', purpose: 'Should fail', validDate: TODAY }],
    ['gate works the complaint queue', gate, 'GET', '/api/complaints/society'],
    ['gate records a cash payment', gate, 'POST', `/api/billing/invoices/${mine2.id}/offline-payment`, { invoiceId: mine2.id, amountPaise: 100, method: 'CASH', receivedOn: TODAY }],
    ['gate cancels an invoice', gate, 'POST', `/api/billing/invoices/${cancelTarget.id}/cancel`, { invoiceId: cancelTarget.id, reason: 'Not the gate\'s call.' }],
  ];
  for (const [name, who, method, path, json] of matrix) {
    const r = await api(who, method, path, ...(json === undefined ? [] : [{ json }]));
    check(name, r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)?.slice(0, 80)}`);
  }

  // ---------------------------------------------------------------- the outbox, honestly
  begin('the outbox — every row this walk caused has been drained');
  // The workers drain on their own interval, so this waits for the queue to go quiet rather than
  // asserting on an instant.
  const stuck = await poll(() => {
    const rows = dbAll("SELECT id, type, channel, status FROM outbox_event WHERE status IN ('PENDING', 'FAILED', 'ABANDONED')");
    return rows.length === 0 ? [] : undefined;
  }, { attempts: 20, intervalMs: 2000 });
  check('no outbox row is stuck', stuck !== undefined && stuck.length === 0, JSON.stringify(dbAll("SELECT id, type, channel, status FROM outbox_event WHERE status IN ('PENDING', 'FAILED', 'ABANDONED')").slice(0, 5)));
  const sentMail = dbAll("SELECT COUNT(*) AS n FROM mail_message WHERE status = 'SENT'");
  check('the mail log recorded the walk\'s messages', (sentMail[0]?.n ?? 0) >= 2, `${sentMail[0]?.n ?? 0} sent`);

  // ---------------------------------------------------------------- the website itself
  begin('the website — server-rendered pages answer');
  const home = await fetch(`${BASE_URL}/`);
  const homeHtml = await home.text();
  check('the marketing home renders', home.status === 200 && homeHtml.includes('<html'), `status ${home.status}`);
  check('no coursework framing on the page', !/UC-\d{2}|BCSE\d{2,}|24BCE\d+|Coursework|Simulated/i.test(homeHtml), 'forbidden token found in the rendered HTML');

  // ---------------------------------------------------------------- the PWA's files
  begin('the PWA — manifest, icons, service worker');
  const appPublic = join(repoRoot, 'apps', 'app', 'public');
  const manifestPath = join(appPublic, 'manifest.webmanifest');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    check('the manifest parses and names icons', Array.isArray(manifest.icons) && manifest.icons.length >= 2, JSON.stringify(manifest.icons)?.slice(0, 120));
    const missing = manifest.icons.filter((i) => !existsSync(join(appPublic, i.src.replace(/^\//, ''))));
    check('every icon the manifest names exists on disk', missing.length === 0, JSON.stringify(missing));
  } else {
    check('the manifest parses and names icons', false, 'apps/app/public/manifest.webmanifest not found');
  }
  const swPath = join(appPublic, 'sw.js');
  if (existsSync(swPath)) {
    const sw = readFileSync(swPath, 'utf8');
    const syntax = spawnSync(process.execPath, ['--check', swPath], { encoding: 'utf8' });
    check('the service worker parses', syntax.status === 0, String(syntax.stderr).slice(0, 120));
    check('it handles push events', /addEventListener\(\s*['"]push['"]/.test(sw), 'no push listener');
    check('and notification clicks', /addEventListener\(\s*['"]notificationclick['"]/.test(sw), 'no notificationclick listener');
  } else {
    check('the service worker parses', false, 'apps/app/public/sw.js not found');
  }

  // ---------------------------------------------------------------- summary
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nthe walk itself failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
