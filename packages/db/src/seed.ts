/**
 * The seed: Nandanam Grove Residency, a lived-in society.
 *
 * A fresh local install should not look like a schema with four rows in it. This file writes one
 * whole residential community — three blocks and forty-six units, a committee, a gate desk, three
 * dozen residents with homes, three billing periods of invoices and payments with numbered
 * receipts, a complaint queue with history, facility bookings, notices with real bodies, visitor
 * passes and a gate log, and a handful of notifications. Every string is hand-authored; there is
 * no randomness anywhere, so seeding twice produces the same database.
 *
 * Convergence contract (the seed-idempotency test digests every domain table over two runs):
 *
 *   - Every row with a unique key is an upsert with a DELIBERATELY EMPTY update block. A second
 *     run therefore writes nothing — not even the same values. This matters because a same-values
 *     update would rewrite `passwordHash` (bcrypt salts every hash) and bump `@updatedAt`,
 *     breaking the byte-for-byte digest the test compares.
 *   - Tables without a unique constraint (complaint, complaintUpdate, visitorLog, booking,
 *     announcement, notification) use the `ensureRow` find-first-then-create pattern with an
 *     EXPLICIT deterministic `createdAt`. A defaulted now() would differ between runs and create
 *     duplicates; the natural-key find (unitId+createdAt and friends) makes the second run a
 *     no-op instead.
 *   - The clock is frozen once at module load. The idempotency test calls seed() twice in one
 *     process, and one frozen `SEED_NOW` makes the two runs agree by construction — even across
 *     midnight. All timestamps are derived from it with fixed offsets, never from new Date()
 *     scattered through the data.
 *
 * The account bootstrap invariant is preserved: `committee@oneresi.in` is the FIRST account
 * created, role 'A', status ACTIVE. Registration grants the first-ever account immediate
 * membership and queues everyone after it (packages/domain/src/accounts.ts), so as long as the
 * committee exists and is ACTIVE, the post-seed registration queue behaves exactly as the
 * runbook documents. `vikram@oneresi.in` and `kabir.chowdhury@gmail.com` sit in that queue, the
 * first with a live registration claim for a flat that is not on the register yet.
 *
 * The password is generated or set through SEED_PASSWORD, hashed once with bcrypt, and written on
 * the create branch only — which is why the update branches must stay empty.
 *
 * Register note: the billing months are computed relative to the run date (current month and the
 * two before it), because dues are a rolling calendar. A seed run twice in a row — what the
 * idempotency test and `pnpm bootstrap` do — is byte-stable. A seed run weeks later over the same
 * file adds the newer months' rows and leaves the older ones alone.
 */
import { hash } from 'bcryptjs';
import * as C from '@oneresi/contracts';
import { getDb, liveTarget } from './client.js';
import type { Db } from './client.js';
import { hoursTouched } from './stores/shared.js';

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'starling-marble-97-QUAY';

/** Frozen once; see the module header for why. */
const SEED_NOW = new Date();

const COMMITTEE_EMAIL = 'committee@oneresi.in';
const GATE_EMAIL = 'gate@oneresi.in';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- the clock

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** UTC midnight of today + offset days. */
function utcMidnight(dayOffset: number): Date {
  const d = new Date(SEED_NOW);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + dayOffset * DAY_MS);
}

/**
 * An instant at an Indian Standard Time wall clock (UTC+5:30, no DST): `ist(-3, 10, 15)` is
 * 10:15 IST three days ago. Only used for hours >= 6 so the instant stays on the intended UTC day.
 */
function ist(dayOffset: number, hour: number, minute: number): Date {
  return new Date(utcMidnight(dayOffset).getTime() + (hour * 60 + minute - 330) * 60_000);
}

/** The YYYY-MM period `offsetMonths` away from the run month. */
function periodAt(offsetMonths: number): string {
  const d = new Date(SEED_NOW);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** A UTC instant inside a billing period: the 1st at 04:00 UTC is 09:30 IST. */
function monthDay(period: string, day: number, hour: number, minute: number): Date {
  return new Date(`${period}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00.000Z`);
}

// ---------------------------------------------------------------- the property

interface UnitSpec {
  readonly label: string;
  readonly type: C.UnitType;
  readonly chargeRupees: number;
}

const BLOCKS = [
  { name: 'Gulmohar Court', floors: 5 },
  { name: 'Jamun Court', floors: 4 },
  { name: 'Palm Villas', floors: 2 },
] as const;

const GULMOHAR_UNITS: UnitSpec[] = [];
for (let floor = 1; floor <= 5; floor += 1) {
  GULMOHAR_UNITS.push(
    { label: `A-${floor}01`, type: 'FLAT_2BHK', chargeRupees: 3_500 },
    { label: `A-${floor}02`, type: 'FLAT_3BHK', chargeRupees: 4_800 },
    { label: `A-${floor}03`, type: 'FLAT_2BHK', chargeRupees: 3_500 },
    { label: `A-${floor}04`, type: 'FLAT_3BHK', chargeRupees: 4_800 },
  );
}
GULMOHAR_UNITS.push(
  { label: 'S-01', type: 'SHOP', chargeRupees: 5_000 },
  { label: 'S-02', type: 'SHOP', chargeRupees: 5_000 },
);

const JAMUN_UNITS: UnitSpec[] = [];
for (let floor = 1; floor <= 4; floor += 1) {
  JAMUN_UNITS.push(
    { label: `B-${floor}01`, type: 'FLAT_1BHK', chargeRupees: 2_400 },
    { label: `B-${floor}02`, type: 'FLAT_2BHK', chargeRupees: 3_500 },
    { label: `B-${floor}03`, type: 'FLAT_2BHK', chargeRupees: 3_500 },
    floor === 4
      ? { label: 'B-404', type: 'FLAT_4BHK', chargeRupees: 6_500 }
      : { label: `B-${floor}04`, type: 'FLAT_3BHK', chargeRupees: 4_800 },
  );
}

const VILLA_UNITS: UnitSpec[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  label: `V-0${n}`,
  type: 'VILLA' as const,
  chargeRupees: 7_500,
}));

const ALL_UNITS: readonly UnitSpec[] = [...GULMOHAR_UNITS, ...JAMUN_UNITS, ...VILLA_UNITS];

// ---------------------------------------------------------------- the people

interface PersonSpec {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
  readonly role: C.Role;
  readonly status: C.UserStatus;
  readonly unitLabel: string | null;
  readonly joinedDay: number;
}

// The committee account is FIRST: the first-ever account is the one registration admits without a
// queue, and the runbook documents this email as the desk sign-in. Everyone after it queues.
const PEOPLE: readonly PersonSpec[] = [
  { email: COMMITTEE_EMAIL, name: 'Vasanthi Raman', phone: '+919847051201', role: 'A', status: 'ACTIVE', unitLabel: 'V-04', joinedDay: -620 },
  { email: GATE_EMAIL, name: 'Narayana Swamy', phone: '+919590212246', role: 'S', status: 'ACTIVE', unitLabel: null, joinedDay: -430 },

  { email: 'saarathi@oneresi.in', name: 'Saarathi Niranjan Kumar', phone: '+919972204518', role: 'R', status: 'ACTIVE', unitLabel: 'A-101', joinedDay: -540 },
  { email: 'priya.sharma79@gmail.com', name: 'Priya Sharma', phone: '+919820335167', role: 'R', status: 'ACTIVE', unitLabel: 'A-102', joinedDay: -520 },
  { email: 'rajesh.menon@gmail.com', name: 'Rajesh Menon', phone: '+919845661209', role: 'R', status: 'ACTIVE', unitLabel: 'A-103', joinedDay: -505 },
  { email: 'lakshmi.menon@gmail.com', name: 'Lakshmi Menon', phone: '+919845662384', role: 'R', status: 'ACTIVE', unitLabel: 'A-103', joinedDay: -505 },
  { email: 'anand.iyer@outlook.com', name: 'Anand Iyer', phone: '+919940287653', role: 'R', status: 'ACTIVE', unitLabel: 'A-104', joinedDay: -490 },
  { email: 'kavitha.reddy@gmail.com', name: 'Kavitha Reddy', phone: '+919701354892', role: 'R', status: 'ACTIVE', unitLabel: 'A-201', joinedDay: -470 },
  { email: 'imran.khan786@yahoo.co.in', name: 'Imran Khan', phone: '+919849772265', role: 'R', status: 'ACTIVE', unitLabel: 'A-202', joinedDay: -455 },
  { email: 'deepa.patel@gmail.com', name: 'Deepa Patel', phone: '+919727480013', role: 'R', status: 'ACTIVE', unitLabel: 'A-203', joinedDay: -430 },
  { email: 'sunil.desai@gmail.com', name: 'Sunil Desai', phone: '+919925463781', role: 'R', status: 'ACTIVE', unitLabel: 'A-204', joinedDay: -415 },
  { email: 'meera.krishnan@gmail.com', name: 'Meera Krishnan', phone: '+919840751236', role: 'R', status: 'ACTIVE', unitLabel: 'A-301', joinedDay: -400 },
  { email: 'harish.bhatt@outlook.com', name: 'Harish Bhatt', phone: '+919762334087', role: 'R', status: 'ACTIVE', unitLabel: 'A-302', joinedDay: -380 },
  { email: 'shobha.kulkarni@gmail.com', name: 'Shobha Kulkarni', phone: '+919921568704', role: 'R', status: 'ACTIVE', unitLabel: 'A-303', joinedDay: -360 },
  { email: 'george.fernandes@yahoo.co.in', name: 'George Fernandes', phone: '+919865442310', role: 'R', status: 'ACTIVE', unitLabel: 'A-401', joinedDay: -340 },
  { email: 'arundhati.bose@gmail.com', name: 'Arundhati Bose', phone: '+919903876145', role: 'R', status: 'ACTIVE', unitLabel: 'A-402', joinedDay: -320 },
  { email: 'prakash.hegde@gmail.com', name: 'Prakash Hegde', phone: '+919741255830', role: 'R', status: 'ACTIVE', unitLabel: 'A-403', joinedDay: -300 },
  { email: 'dilip.joshi@gmail.com', name: 'Dilip Joshi', phone: '+919822174065', role: 'R', status: 'ACTIVE', unitLabel: 'A-501', joinedDay: -280 },
  { email: 'rekha.pillai@gmail.com', name: 'Rekha Pillai', phone: '+919946803712', role: 'R', status: 'ACTIVE', unitLabel: 'A-502', joinedDay: -260 },
  { email: 'cyrus.irani@gmail.com', name: 'Cyrus Irani', phone: '+919920578461', role: 'R', status: 'ACTIVE', unitLabel: 'S-01', joinedDay: -240 },
  { email: 'santosh.yadav@gmail.com', name: 'Santosh Yadav', phone: '+919876554230', role: 'R', status: 'ACTIVE', unitLabel: 'B-101', joinedDay: -220 },
  { email: 'farida.sheikh@yahoo.co.in', name: 'Farida Sheikh', phone: '+919910427385', role: 'R', status: 'ACTIVE', unitLabel: 'B-102', joinedDay: -200 },
  { email: 'venkat.rao@gmail.com', name: 'Venkat Rao', phone: '+919848660127', role: 'R', status: 'ACTIVE', unitLabel: 'B-103', joinedDay: -180 },
  { email: 'aparna.chatterjee@gmail.com', name: 'Aparna Chatterjee', phone: '+919931758046', role: 'R', status: 'ACTIVE', unitLabel: 'B-201', joinedDay: -160 },
  { email: 'manjeet.singh@gmail.com', name: 'Manjeet Singh', phone: '+919877010954', role: 'R', status: 'ACTIVE', unitLabel: 'B-202', joinedDay: -140 },
  { email: 'nithya.subramanian@gmail.com', name: 'Nithya Subramanian', phone: '+919944125378', role: 'R', status: 'ACTIVE', unitLabel: 'B-203', joinedDay: -120 },
  { email: 'rohan.gokhale@outlook.com', name: 'Rohan Gokhale', phone: '+919767421380', role: 'R', status: 'ACTIVE', unitLabel: 'B-301', joinedDay: -100 },
  { email: 'savita.bansal@gmail.com', name: 'Savita Bansal', phone: '+919812673940', role: 'R', status: 'ACTIVE', unitLabel: 'B-302', joinedDay: -80 },
  { email: 'joseph.thomas@gmail.com', name: 'Joseph Thomas', phone: '+919947583126', role: 'R', status: 'ACTIVE', unitLabel: 'B-303', joinedDay: -60 },
  { email: 'gauri.sathe@gmail.com', name: 'Gauri Sathe', phone: '+919922346715', role: 'R', status: 'ACTIVE', unitLabel: 'B-401', joinedDay: -50 },
  { email: 'mohan.prabhu@gmail.com', name: 'Mohan Prabhu', phone: '+919986210437', role: 'R', status: 'ACTIVE', unitLabel: 'B-402', joinedDay: -40 },
  { email: 'aditya.malhotra@gmail.com', name: 'Aditya Malhotra', phone: '+919810564728', role: 'R', status: 'ACTIVE', unitLabel: 'B-404', joinedDay: -30 },
  { email: 'balagopal.nair@gmail.com', name: 'Balagopal Nair', phone: '+919947501682', role: 'R', status: 'ACTIVE', unitLabel: 'V-01', joinedDay: -570 },
  { email: 'sunita.agarwal@gmail.com', name: 'Sunita Agarwal', phone: '+919910384256', role: 'R', status: 'ACTIVE', unitLabel: 'V-02', joinedDay: -560 },
  { email: 'randhir.rathore@gmail.com', name: 'Randhir Rathore', phone: '+919829077413', role: 'R', status: 'ACTIVE', unitLabel: 'V-03', joinedDay: -545 },
  { email: 'esther.david@yahoo.co.in', name: 'Esther David', phone: '+919940261875', role: 'R', status: 'ACTIVE', unitLabel: 'V-05', joinedDay: -520 },

  // The registration queue. The committee's approve/decline flow has a live claim (a flat that is
  // not on the register yet) and a plain application on an existing unit to work on.
  { email: 'vikram@oneresi.in', name: 'Vikram Verma', phone: '+919845832290', role: 'R', status: 'PENDING', unitLabel: null, joinedDay: -3 },
  { email: 'kabir.chowdhury@gmail.com', name: 'Kabir Chowdhury', phone: '+919978145206', role: 'R', status: 'PENDING', unitLabel: 'A-404', joinedDay: -1 },
  // A declined application stays in the register forever, with its claim stamped by the committee.
  { email: 'nikhil.bansal@gmail.com', name: 'Nikhil Bansal', phone: '+919971428536', role: 'R', status: 'REJECTED', unitLabel: null, joinedDay: -9 },
];

// ---------------------------------------------------------------- the facilities

const FACILITIES = [
  {
    name: 'Clubhouse Hall',
    description:
      'Air-conditioned hall with a stage, tables for eighty and a serving kitchen. The terrace opens off the hall for evening functions.',
    opensAt: '09:00',
    closesAt: '23:00',
    hourlyRateRupees: 750,
    bookingRules:
      'Decorations must be freestanding; nothing is to be fixed to the walls or the ceiling. Music winds down by 22:30 as a courtesy to Palm Villas.',
  },
  {
    name: 'Badminton Court',
    description: 'Indoor synthetic court with floodlights and a viewing gallery of eight seats.',
    opensAt: '06:00',
    closesAt: '22:00',
    hourlyRateRupees: 150,
    bookingRules: 'Non-marking shoes compulsory. Shuttlecocks are not provided.',
  },
  {
    name: 'Tennis Court',
    description: 'Outdoor all-weather hard court, floodlit until closing time.',
    opensAt: '06:00',
    closesAt: '21:00',
    hourlyRateRupees: 200,
    bookingRules: 'Reservation holds the court for fifteen minutes past the start time.',
  },
  {
    name: 'Gymnasium',
    description:
      'Treadmills, cross-trainers, cycles and a free-weights corner. A trainer is on duty 06:00 to 09:00 on weekdays.',
    opensAt: '05:30',
    closesAt: '22:00',
    hourlyRateRupees: 100,
    bookingRules: 'Members above fifteen only. Carry a towel; wipe down equipment after use.',
  },
  {
    name: 'Swimming Pool',
    description: 'Half-Olympic pool, 1.2 metres at the deep end, with a children’s corner.',
    opensAt: '06:00',
    closesAt: '21:00',
    hourlyRateRupees: 200,
    bookingRules: 'Swim cap compulsory. No glass on the deck; children under twelve with an adult.',
  },
] as const;

// ---------------------------------------------------------------- billing shape

const P2 = periodAt(-2);
const P1 = periodAt(-1);
const P0 = periodAt(0);

/** Units that missed last month's due date entirely — the committee's collections problem. */
const DELINQUENT_UNITS = new Set(['B-303', 'A-502']);
/** Units that paid last month, but only after the due date had passed. */
const LATE_PAYER_UNITS = new Set(['A-202', 'V-03', 'B-101']);
/** Units that have already paid the current month (early in the month, as people do). */
const EAGER_PAYER_UNITS = [
  'A-101',
  'A-102',
  'A-103',
  'A-201',
  'A-303',
  'A-401',
  'A-501',
  'B-102',
  'B-202',
  'B-302',
  'B-402',
  'V-01',
  'S-01',
] as const;

interface PlannedPayment {
  readonly period: string;
  readonly label: string;
  readonly paidAt: Date;
}

/** A settled invoice paid before the 10th, on a day spread by the unit's position in the list. */
function earlyPayInstant(period: string, index: number): Date {
  return monthDay(period, 2 + (index * 3) % 7, 1 + (index * 5) % 14, (index * 17) % 60);
}

/** A settled invoice paid after the due date — the 13th or the 14th, by position. */
function latePayInstant(period: string, index: number): Date {
  return monthDay(period, 13 + (index % 2), 3 + (index % 9), (index * 13) % 60);
}

function methodFor(index: number): C.PaymentMethod {
  if (index % 11 === 5) return 'CASH';
  if (index % 5 === 2) return 'NETBANKING';
  if (index % 7 === 6) return 'CARD';
  return 'UPI';
}

// ---------------------------------------------------------------- complaints

interface ComplaintMove {
  readonly at: Date;
  readonly statusAfter: C.ComplaintStatus;
  readonly byEmail: string;
  readonly note: string;
}

interface ComplaintSpec {
  readonly unitLabel: string;
  readonly category: C.ComplaintCategory;
  readonly priority: C.ComplaintPriority;
  readonly description: string;
  readonly raisedAt: Date;
  readonly trail: readonly ComplaintMove[];
}

const COMPLAINTS: readonly ComplaintSpec[] = [
  {
    unitLabel: 'A-102',
    category: 'PLUMBING',
    priority: 'HIGH',
    description:
      'The wash basin in the master bathroom has been draining slower every day for a week, and there is a damp patch on the cupboard wall below it. By evening the whole corner smells of stagnant water.',
    raisedAt: ist(-42, 9, 12),
    trail: [
      {
        at: ist(-41, 10, 30),
        statusAfter: 'IN_PROGRESS',
        byEmail: COMMITTEE_EMAIL,
        note: 'Ravi the plumber has been assigned and will visit tomorrow between 10:00 and 11:00. Please keep the bathroom accessible.',
      },
      {
        at: ist(-39, 16, 45),
        statusAfter: 'RESOLVED',
        byEmail: COMMITTEE_EMAIL,
        note: 'The trap was blocked with construction grit and has been cleared, and the angle valve was replaced as a precaution. The wall has been left to dry; the painter will touch it up next week on the society account.',
      },
    ],
  },
  {
    unitLabel: 'B-203',
    category: 'ELECTRICAL',
    priority: 'MEDIUM',
    description:
      'The corridor light outside B-203 flickers all night and sometimes goes off completely, leaving the whole stretch up to the stairwell dark.',
    raisedAt: ist(-35, 20, 5),
    trail: [
      {
        at: ist(-34, 9, 15),
        statusAfter: 'IN_PROGRESS',
        byEmail: COMMITTEE_EMAIL,
        note: 'The electrician has ordered the LED driver; the part reaches the office by Friday and the fitting will be replaced the same evening.',
      },
      {
        at: ist(-31, 15, 10),
        statusAfter: 'RESOLVED',
        byEmail: COMMITTEE_EMAIL,
        note: 'The corroded driver and the holder were replaced and the fitting resealed. The corridor light has been stable for three nights since.',
      },
    ],
  },
  {
    unitLabel: 'V-03',
    category: 'SECURITY',
    priority: 'HIGH',
    description:
      'Two helmets and a cycle were taken from the villa carport some time last night, though the gate log shows no stranger entering. The carports are not covered by the current camera angle.',
    raisedAt: ist(-22, 7, 40),
    trail: [
      {
        at: ist(-22, 11, 0),
        statusAfter: 'IN_PROGRESS',
        byEmail: COMMITTEE_EMAIL,
        note: 'The footage of the service gate between 23:00 and 05:00 is being reviewed with the security agency, and a quote for a second camera covering the villa carports is with the committee.',
      },
      {
        at: ist(-20, 9, 30),
        statusAfter: 'RESOLVED',
        byEmail: COMMITTEE_EMAIL,
        note: 'The night patrol now covers the villa loop every ninety minutes, and the additional camera was approved at the committee meeting and installed on Saturday. The cycle was found abandoned near the service gate.',
      },
    ],
  },
  {
    unitLabel: 'A-301',
    category: 'COMMON_AREA',
    priority: 'LOW',
    description:
      'The granite bench under the Gulmohar podium has a loose slab that rocks whenever anyone sits on it, and two children have started using it as a step.',
    raisedAt: ist(-60, 12, 15),
    trail: [
      {
        at: ist(-58, 10, 0),
        statusAfter: 'IN_PROGRESS',
        byEmail: COMMITTEE_EMAIL,
        note: 'The slab has been lifted and reset on a fresh mortar bed by the mason. It needs two days to cure before the bench can be used.',
      },
      {
        at: ist(-55, 17, 20),
        statusAfter: 'RESOLVED',
        byEmail: COMMITTEE_EMAIL,
        note: 'The bench is set and level again, and the mason checked the other three podium benches as well — one more had the same fault and was fixed the same day.',
      },
      {
        at: ist(-48, 12, 0),
        statusAfter: 'CLOSED',
        byEmail: COMMITTEE_EMAIL,
        note: 'Mrs Krishnan confirmed on the Sunday walk that the bench is firm. Closing the complaint; the mason’s visit note is filed at the office.',
      },
    ],
  },
  {
    unitLabel: 'A-202',
    category: 'PLUMBING',
    priority: 'MEDIUM',
    description:
      'There is a slow seep from under the commode in the common bathroom. The floor never dries fully and the ant problem is back because of it.',
    raisedAt: ist(-12, 9, 0),
    trail: [
      {
        at: ist(-11, 11, 5),
        statusAfter: 'IN_PROGRESS',
        byEmail: COMMITTEE_EMAIL,
        note: 'The plumber resealed the commode base this afternoon; please leave the bathroom unused for six hours so the sealant cures.',
      },
      {
        at: ist(-9, 16, 20),
        statusAfter: 'RESOLVED',
        byEmail: COMMITTEE_EMAIL,
        note: 'The commode base has been resealed and the floor mason will grout the tiles along the skirting tomorrow. No dampness was reported overnight.',
      },
      {
        at: ist(-7, 10, 10),
        statusAfter: 'OPEN',
        byEmail: 'imran.khan786@yahoo.co.in',
        note: 'The seal holds through the day, but the bathroom floor is wet again by morning. The leak is deeper than the angle valve.',
      },
    ],
  },
  {
    unitLabel: 'A-302',
    category: 'ELECTRICAL',
    priority: 'URGENT',
    description:
      'The mains trip in flat 302 goes off whenever the geyser and the microwave run together, which they did for years without a problem. It has happened four times since yesterday.',
    raisedAt: ist(-2, 21, 30),
    trail: [
      {
        at: ist(-1, 8, 50),
        statusAfter: 'IN_PROGRESS',
        byEmail: COMMITTEE_EMAIL,
        note: 'The electrician will attend first thing tomorrow morning. Please keep the geyser off tonight so the board can be inspected cold.',
      },
    ],
  },
  {
    unitLabel: 'A-204',
    category: 'CIVIL',
    priority: 'MEDIUM',
    description:
      'A crack has appeared in the balcony parapet plaster near the rainwater pipe joint, and a palm-sized piece of plaster is hanging from it directly above the podium.',
    raisedAt: ist(-1, 17, 20),
    trail: [],
  },
  {
    unitLabel: 'V-05',
    category: 'SECURITY',
    priority: 'MEDIUM',
    description:
      'The villa gate lamp has not been switching on at dusk for the last three days; the approach to V-05 and V-06 is pitch dark after 19:00.',
    raisedAt: ist(-4, 22, 15),
    trail: [],
  },
  {
    unitLabel: 'A-403',
    category: 'OTHER',
    priority: 'LOW',
    description:
      'A cat has moved into the stairwell between the third and fourth floors and, judging by the smell, has chosen the landing as its corner.',
    raisedAt: ist(-18, 15, 0),
    trail: [
      {
        at: ist(-17, 10, 30),
        statusAfter: 'IN_PROGRESS',
        byEmail: COMMITTEE_EMAIL,
        note: 'The shelter has been contacted; they will set a humane trap on the landing on Thursday and ask that the stairwell door be kept shut till then.',
      },
      {
        at: ist(-15, 13, 45),
        statusAfter: 'RESOLVED',
        byEmail: COMMITTEE_EMAIL,
        note: 'The cat was collected by the care volunteer and has been rehomed. The landing has been washed and sanitised by the housekeeping crew.',
      },
    ],
  },
];

// ---------------------------------------------------------------- bookings

interface BookingSpec {
  readonly facilityName: string;
  readonly unitLabel: string;
  readonly onDay: number;
  readonly start: string;
  readonly end: string;
  readonly amountRupees: number;
  readonly status: C.BookingStatus;
  readonly requestedAt: Date;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
  readonly updatedAt: Date;
}

const BOOKINGS: readonly BookingSpec[] = [
  {
    facilityName: 'Clubhouse Hall',
    unitLabel: 'A-201',
    onDay: -12,
    start: '18:00',
    end: '22:00',
    amountRupees: 3_000,
    status: 'COMPLETED',
    requestedAt: ist(-13, 19, 40),
    decidedAt: ist(-11, 10, 0),
    decisionReason: null,
    updatedAt: ist(-12, 23, 30),
  },
  {
    facilityName: 'Badminton Court',
    unitLabel: 'B-202',
    onDay: -9,
    start: '07:00',
    end: '08:00',
    amountRupees: 150,
    status: 'COMPLETED',
    requestedAt: ist(-10, 21, 5),
    decidedAt: ist(-10, 21, 30),
    decisionReason: null,
    updatedAt: ist(-9, 8, 30),
  },
  {
    facilityName: 'Clubhouse Hall',
    unitLabel: 'V-02',
    onDay: 5,
    start: '17:00',
    end: '21:00',
    amountRupees: 3_000,
    status: 'CONFIRMED',
    requestedAt: ist(-2, 9, 10),
    decidedAt: ist(-1, 12, 0),
    decisionReason: null,
    updatedAt: ist(-1, 12, 0),
  },
  {
    facilityName: 'Gymnasium',
    unitLabel: 'A-104',
    onDay: 2,
    start: '06:30',
    end: '07:30',
    amountRupees: 100,
    status: 'CONFIRMED',
    requestedAt: ist(-2, 20, 30),
    decidedAt: ist(-1, 9, 15),
    decisionReason: null,
    updatedAt: ist(-1, 9, 15),
  },
  {
    facilityName: 'Badminton Court',
    unitLabel: 'B-301',
    onDay: 1,
    start: '19:00',
    end: '20:00',
    amountRupees: 150,
    status: 'PENDING',
    requestedAt: ist(0, 6, 40),
    decidedAt: null,
    decisionReason: null,
    updatedAt: ist(0, 6, 40),
  },
  {
    facilityName: 'Swimming Pool',
    unitLabel: 'A-402',
    onDay: 9,
    start: '10:00',
    end: '12:00',
    amountRupees: 400,
    status: 'PENDING',
    requestedAt: ist(-1, 16, 45),
    decidedAt: null,
    decisionReason: null,
    updatedAt: ist(-1, 16, 45),
  },
  {
    facilityName: 'Tennis Court',
    unitLabel: 'V-05',
    onDay: -20,
    start: '16:00',
    end: '18:00',
    amountRupees: 400,
    status: 'REJECTED',
    requestedAt: ist(-24, 14, 0),
    decidedAt: ist(-22, 11, 20),
    decisionReason:
      'The court is closed for resurfacing that weekend, so the request cannot be confirmed. The next open slot from the following Tuesday is free if you would like to rebook.',
    updatedAt: ist(-22, 11, 20),
  },
  {
    facilityName: 'Clubhouse Hall',
    unitLabel: 'B-103',
    onDay: -30,
    start: '12:00',
    end: '16:00',
    amountRupees: 3_000,
    status: 'CANCELLED',
    requestedAt: ist(-33, 18, 0),
    decidedAt: null,
    decisionReason: null,
    updatedAt: ist(-31, 9, 0),
  },
];

// ---------------------------------------------------------------- notices

interface NoticeSpec {
  readonly category: C.AnnouncementCategory;
  readonly pinned: boolean;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

const NOTICES: readonly NoticeSpec[] = [
  {
    category: 'MAINTENANCE',
    pinned: true,
    title: 'Overhead tank cleaning this Saturday — supply off 10:00 to 13:00',
    body:
      'Both overhead tanks in Gulmohar and Jamun Court are due for their quarterly cleaning this Saturday. Water supply will be off from 10:00 to about 13:00 in the two blocks; Palm Villas is on the separate line and is not affected. Please store what you need for the morning and keep the terrace access clear for the contractor’s crew. The chlorination report will be filed at the office, where any resident can ask to see it.',
    createdAt: ist(-3, 8, 30),
    expiresAt: utcMidnight(5),
  },
  {
    category: 'GENERAL',
    pinned: true,
    title: 'AGM on the last Saturday of the month — notice and provisional agenda',
    body:
      'Notice is hereby given of the Annual General Body Meeting of Nandanam Grove Residency, to be held in the Clubhouse Hall at 10:30. Agenda: presentation of the audited accounts for the year; the quote for refurbishing the overhead tanks and the pump room; the proposal to bring the gate under pass-code entry for delivery partners; election of one committee member (secretary); and any other business with the chair’s permission. A member unable to attend may appoint a proxy on the form available at the society office. Tea will be served after the meeting.',
    createdAt: ist(-6, 17, 45),
    expiresAt: null,
  },
  {
    category: 'EVENT',
    pinned: false,
    title: 'Dandiya evening at the Clubhouse Hall — registrations open',
    body:
      'The cultural committee is hosting a dandiya evening in the Clubhouse Hall from 19:00, with a beginners’ round for the children first. Entry is free for residents; guests are welcome with a visitor pass raised in advance, as the gate will be strict that night. Dandiya sticks will be handed out at the door and collected back — please do not bring your own. Collect belongings from the badminton court shoe racks before 23:00, when the hall closes.',
    createdAt: ist(-2, 20, 0),
    expiresAt: null,
  },
  {
    category: 'MAINTENANCE',
    pinned: false,
    title: 'Lift maintenance in Jamun Court completed',
    body:
      'The lift technician completed the quarterly servicing of both lifts in Jamun Court yesterday. The door sensors were recalibrated, and the emergency phone in lift B2 now rings the guard desk instead of the old committee number. If a lift stalls or the alarm does not answer, call the guard desk — the number is on the certificate inside the cabin.',
    createdAt: ist(-16, 10, 0),
    expiresAt: utcMidnight(-8),
  },
  {
    category: 'GENERAL',
    pinned: false,
    title: 'Registering domestic helps and daily service providers at the gate',
    body:
      'From the start of next month, the guard desk will keep a register of domestic helps, drivers and daily service providers working in the society. Each provider gets a gate card with their photograph; residents should ask their regular helps to carry it. One-time visitors continue on visitor passes. The register stays at the guard desk and is not shared outside the society.',
    createdAt: ist(-24, 12, 0),
    expiresAt: null,
  },
  {
    category: 'URGENT',
    pinned: false,
    title: 'Water pressure in Gulmohar floors 4 and 5 restored',
    body:
      'The pressure drop in Gulmohar Court floors 4 and 5 this evening was traced to a partially closed valve in the pump room, left that way after the morning’s motor servicing. The valve has been reopened and the tanks are refilling; pressure should be normal by 21:00. Apologies for the disruption.',
    createdAt: ist(-30, 19, 30),
    expiresAt: utcMidnight(-28),
  },
];

// ---------------------------------------------------------------- visitors

interface PassSpec {
  readonly code: string;
  readonly unitLabel: string;
  readonly createdByEmail: string;
  readonly visitorName: string;
  readonly purpose: string;
  readonly validOnDay: number;
  readonly status: C.PassStatus;
  readonly createdAt: Date;
  readonly cancelledAt: Date | null;
}

const PASSES: readonly PassSpec[] = [
  {
    code: '583214',
    unitLabel: 'A-201',
    createdByEmail: 'kavitha.reddy@gmail.com',
    visitorName: 'Lakshmi Iyer',
    purpose: 'Family visit for the day',
    validOnDay: -7,
    status: 'USED',
    createdAt: ist(-8, 19, 20),
    cancelledAt: null,
  },
  {
    code: '129047',
    unitLabel: 'A-102',
    createdByEmail: 'priya.sharma79@gmail.com',
    visitorName: 'Prakash Rao',
    purpose: 'Delivering plumbing material',
    validOnDay: -3,
    status: 'USED',
    createdAt: ist(-3, 8, 0),
    cancelledAt: null,
  },
  {
    code: '730561',
    unitLabel: 'B-203',
    createdByEmail: 'nithya.subramanian@gmail.com',
    visitorName: 'Ravi Chandrasekhar',
    purpose: 'Here to collect documents',
    validOnDay: -15,
    status: 'EXPIRED',
    createdAt: ist(-16, 21, 0),
    cancelledAt: null,
  },
  {
    code: '416892',
    unitLabel: 'V-01',
    createdByEmail: 'balagopal.nair@gmail.com',
    visitorName: 'Meenakshi Nair',
    purpose: 'Interview for household help',
    validOnDay: 0,
    status: 'ACTIVE',
    createdAt: ist(-1, 18, 45),
    cancelledAt: null,
  },
  {
    code: '902375',
    unitLabel: 'A-301',
    createdByEmail: 'meera.krishnan@gmail.com',
    visitorName: 'Dr. Suresh Bhat',
    purpose: 'Follow-up medical visit',
    validOnDay: 0,
    status: 'ACTIVE',
    createdAt: ist(-1, 9, 10),
    cancelledAt: null,
  },
  {
    code: '264818',
    unitLabel: 'A-104',
    createdByEmail: 'anand.iyer@outlook.com',
    visitorName: 'Anjali Deshpande',
    purpose: 'Weekend guest',
    validOnDay: 2,
    status: 'ACTIVE',
    createdAt: ist(0, 6, 35),
    cancelledAt: null,
  },
  {
    code: '348507',
    unitLabel: 'B-302',
    createdByEmail: 'savita.bansal@gmail.com',
    visitorName: 'Vikas Sethi',
    purpose: 'Carpentry work',
    validOnDay: 1,
    status: 'CANCELLED',
    createdAt: ist(-2, 12, 10),
    cancelledAt: ist(-1, 16, 30),
  },
];

/** Pass arrivals: a log row per USED pass, with its entry and exit. */
interface PassLogSpec {
  readonly code: string;
  readonly enteredAt: Date;
  readonly exitedAt: Date;
}

const PASS_LOGS: readonly PassLogSpec[] = [
  { code: '583214', enteredAt: ist(-7, 9, 40), exitedAt: ist(-7, 18, 15) },
  { code: '129047', enteredAt: ist(-3, 11, 5), exitedAt: ist(-3, 11, 50) },
];

interface WalkInSpec {
  readonly unitLabel: string;
  readonly name: string;
  readonly phone: string;
  readonly purpose: string;
  readonly createdAt: Date;
  readonly approvalStatus: C.ApprovalStatus;
  readonly decidedByEmail: string | null;
  readonly decidedAt: Date | null;
  readonly overrideReason: string | null;
}

const WALK_INS: readonly WalkInSpec[] = [
  {
    unitLabel: 'B-103',
    name: 'Sadiq Ali',
    phone: '+919845012233',
    purpose: 'Blue Dart courier for B-103',
    createdAt: ist(-1, 15, 2),
    approvalStatus: 'APPROVED',
    decidedByEmail: 'venkat.rao@gmail.com',
    decidedAt: ist(-1, 15, 6),
    overrideReason: null,
  },
  {
    unitLabel: 'A-402',
    name: 'Ganesh Veer',
    phone: '+918210445671',
    purpose: 'Amazon delivery for A-402',
    createdAt: ist(0, 6, 45),
    approvalStatus: 'PENDING',
    decidedByEmail: null,
    decidedAt: null,
    overrideReason: null,
  },
  {
    unitLabel: 'B-301',
    name: 'Ramesh Yadav',
    phone: '+919845990212',
    purpose: 'Spectacles delivery for B-301',
    createdAt: ist(-5, 11, 50),
    approvalStatus: 'REJECTED',
    decidedByEmail: 'rohan.gokhale@outlook.com',
    decidedAt: ist(-5, 11, 56),
    overrideReason: null,
  },
  {
    unitLabel: 'V-05',
    name: 'Shanta Bai',
    phone: '+919740812255',
    purpose: 'Weekly housekeeping for V-05',
    createdAt: ist(-2, 8, 0),
    approvalStatus: 'APPROVED',
    decidedByEmail: GATE_EMAIL,
    decidedAt: ist(-2, 8, 4),
    overrideReason:
      'Mrs David is travelling this week and confirmed Shanta Bai’s usual Tuesday visit by phone this morning.',
  },
  {
    unitLabel: 'A-102',
    name: 'Joseph K',
    phone: '+919740332118',
    purpose: 'Furniture delivery for A-102',
    createdAt: ist(-10, 14, 0),
    approvalStatus: 'APPROVED',
    decidedByEmail: 'priya.sharma79@gmail.com',
    decidedAt: ist(-10, 14, 8),
    overrideReason: null,
  },
];

// ---------------------------------------------------------------- notifications

type SeededNotificationType =
  | 'pass.created'
  | 'visitor.arrived'
  | 'complaint.raised'
  | 'complaint.reopened';

interface NotificationSpec {
  readonly toEmail: string;
  readonly type: SeededNotificationType;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

const TODAY_ISO = utcMidnight(0).toISOString().slice(0, 10);

/**
 * The wording mirrors inAppNotification (packages/domain/src/notifications.ts) — these rows are
 * what that function would have written for the events below, so the feed reads the same whether
 * a notification came from the seed or from a live request.
 */
const NOTIFICATIONS: readonly NotificationSpec[] = [
  {
    toEmail: 'balagopal.nair@gmail.com',
    type: 'pass.created',
    title: 'Visitor pass ready',
    body: `Meenakshi Nair is expected on ${TODAY_ISO}. Purpose: Interview for household help.`,
    createdAt: ist(-1, 18, 45),
    readAt: null,
  },
  {
    toEmail: 'meera.krishnan@gmail.com',
    type: 'pass.created',
    title: 'Visitor pass ready',
    body: `Dr. Suresh Bhat is expected on ${TODAY_ISO}. Purpose: Follow-up medical visit.`,
    createdAt: ist(-1, 9, 10),
    readAt: ist(-1, 21, 5),
  },
  {
    toEmail: 'kavitha.reddy@gmail.com',
    type: 'visitor.arrived',
    title: 'Your visitor has arrived',
    body: 'Lakshmi Iyer has checked in. Purpose: Family visit for the day.',
    createdAt: ist(-7, 9, 40),
    readAt: ist(-7, 20, 10),
  },
  {
    toEmail: 'priya.sharma79@gmail.com',
    type: 'visitor.arrived',
    title: 'Your visitor has arrived',
    body: 'Prakash Rao has checked in. Purpose: Delivering plumbing material.',
    createdAt: ist(-3, 11, 5),
    readAt: ist(-3, 12, 0),
  },
  {
    toEmail: 'harish.bhatt@outlook.com',
    type: 'complaint.raised',
    title: 'Complaint recorded',
    body: 'Your complaint about Electrical has been recorded.',
    createdAt: ist(-2, 21, 30),
    readAt: null,
  },
  {
    toEmail: 'imran.khan786@yahoo.co.in',
    type: 'complaint.reopened',
    title: 'Complaint reopened',
    body:
      'Your complaint about Plumbing was reopened. Reason: The seal holds through the day, but the bathroom floor is wet again by morning. The leak is deeper than the angle valve.',
    createdAt: ist(-7, 10, 10),
    readAt: null,
  },
];

// ---------------------------------------------------------------- lookups

type UnitRow = Awaited<ReturnType<Db['unit']['create']>>;
type PersonRow = Awaited<ReturnType<Db['residentUser']['create']>>;
type FacilityRow = Awaited<ReturnType<Db['facility']['create']>>;
type PassRow = Awaited<ReturnType<Db['visitorPass']['create']>>;

function unitIdOf(units: ReadonlyMap<string, UnitRow>, label: string): number {
  const row = units.get(label);
  if (row === undefined) throw new Error(`Seed references unknown unit ${label}`);
  return row.id;
}

function personIdOf(people: ReadonlyMap<string, PersonRow>, email: string): number {
  const row = people.get(email);
  if (row === undefined) throw new Error(`Seed references unknown account ${email}`);
  return row.id;
}

function facilityIdOf(facilities: ReadonlyMap<string, FacilityRow>, name: string): number {
  const row = facilities.get(name);
  if (row === undefined) throw new Error(`Seed references unknown facility ${name}`);
  return row.id;
}

/**
 * The convergence pattern for tables without a unique constraint: find by the natural key, create
 * only when absent. The `createdAt` in the natural key is deterministic by construction, so the
 * second run always finds the first run's row and writes nothing.
 */
async function ensureRow<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const existing = await find();
  if (existing !== null) return existing;
  return create();
}

// ---------------------------------------------------------------- sections

async function seedProperty(db: Db): Promise<ReadonlyMap<string, UnitRow>> {
  const blockIds = new Map<string, number>();
  for (const block of BLOCKS) {
    const row = await db.block.upsert({
      // Empty update on purpose: a re-run must not touch what the first run wrote.
      where: { name: block.name },
      update: {},
      create: { name: block.name, floors: block.floors, createdAt: utcMidnight(-720) },
    });
    blockIds.set(block.name, row.id);
  }

  const units = new Map<string, UnitRow>();
  for (const spec of ALL_UNITS) {
    const blockName = spec.label.startsWith('A-') || spec.label.startsWith('S-')
      ? 'Gulmohar Court'
      : spec.label.startsWith('B-')
        ? 'Jamun Court'
        : 'Palm Villas';
    const blockId = blockIds.get(blockName);
    if (blockId === undefined) throw new Error(`Seed references unknown block ${blockName}`);
    const row = await db.unit.upsert({
      where: { blockId_label: { blockId, label: spec.label } },
      update: {},
      create: {
        blockId,
        label: spec.label,
        type: spec.type,
        monthlyChargePaise: C.rupees(spec.chargeRupees),
      },
    });
    units.set(spec.label, row);
  }
  return units;
}

async function seedPeople(db: Db, units: ReadonlyMap<string, UnitRow>): Promise<ReadonlyMap<string, PersonRow>> {
  const passwordHash = await hash(DEMO_PASSWORD, C.BCRYPT_COST);
  const people = new Map<string, PersonRow>();

  for (const [index, person] of PEOPLE.entries()) {
    const joinedAt = ist(person.joinedDay, 10 + (index % 9), (index * 13) % 60);
    const row = await db.residentUser.upsert({
      where: { email: person.email },
      update: {},
      create: {
        name: person.name,
        email: person.email,
        phone: person.phone,
        passwordHash,
        role: person.role,
        status: person.status,
        unitId: person.unitLabel === null ? null : unitIdOf(units, person.unitLabel),
        // resolveActor refuses a session whose passwordChangedAt is null, so every seeded account
        // carries the stamp registration would have set — otherwise the accounts exist but cannot
        // authenticate.
        passwordChangedAt: joinedAt,
        createdAt: joinedAt,
        updatedAt: joinedAt,
      },
    });
    people.set(person.email, row);
  }

  // The registration queue's paperwork. One live claim per applicant (userId is unique); a claim
  // is never deleted, and a declined one keeps its stamps.
  const vikramId = personIdOf(people, 'vikram@oneresi.in');
  await db.registrationClaim.upsert({
    where: { userId: vikramId },
    update: {},
    create: {
      userId: vikramId,
      blockName: 'Jamun Court',
      unitLabel: 'B-105',
      unitType: 'FLAT_2BHK',
      note:
        'I have bought B-105, the corner flat the builder sold as an additional unit. It is not on the society register yet; my sale deed and possession letter are with the office for verification.',
      resolvedUnitId: null,
      decidedById: null,
      resolvedAt: null,
      decisionReason: null,
      createdAt: ist(-3, 21, 10),
      updatedAt: ist(-3, 21, 10),
    },
  });

  const nikhilId = personIdOf(people, 'nikhil.bansal@gmail.com');
  await db.registrationClaim.upsert({
    where: { userId: nikhilId },
    update: {},
    create: {
      userId: nikhilId,
      blockName: 'Palm Villas',
      unitLabel: 'V-09',
      unitType: 'VILLA',
      note:
        'I am taking villa V-09 on rent from the 1st; the agreement was registered last week and the owner’s NOC is with me.',
      resolvedUnitId: null,
      decidedById: personIdOf(people, COMMITTEE_EMAIL),
      resolvedAt: ist(-7, 11, 40),
      decisionReason:
        'Villa V-09 is not on the society register — the plot is still with the builder. Please apply again once the handover is recorded with the office.',
      createdAt: ist(-9, 20, 0),
      updatedAt: ist(-7, 11, 40),
    },
  });

  return people;
}

async function seedFacilities(db: Db): Promise<ReadonlyMap<string, FacilityRow>> {
  const facilities = new Map<string, FacilityRow>();
  for (const facility of FACILITIES) {
    const row = await db.facility.upsert({
      where: { name: facility.name },
      update: {},
      create: {
        name: facility.name,
        description: facility.description,
        opensAt: facility.opensAt,
        closesAt: facility.closesAt,
        hourlyRatePaise: C.rupees(facility.hourlyRateRupees),
        bookingRules: facility.bookingRules,
      },
    });
    facilities.set(facility.name, row);
  }
  return facilities;
}

/**
 * Three billing periods: the two closed months and the current one. Every unit with a charge is
 * billed every period; most settle before the 10th, some after, two households in the middle of a
 * collections problem never settle last month, and one shop's current invoice is cancelled because
 * the unit was handed back vacant. Receipt numbers are allocated per period in (paidAt, unit)
 * order from a sequence seeded past the seeded payments, so the first live payment of any period
 * takes the next number without colliding.
 */
async function seedBilling(
  db: Db,
  units: ReadonlyMap<string, UnitRow>,
  committeeId: number,
): Promise<{ invoices: number; payments: number }> {
  const raisedAt = (period: string): Date => monthDay(period, 1, 4, 0); // 09:30 IST on the 1st
  const dueOn = (period: string): Date => monthDay(period, 10, 0, 0);

  const todayMidnight = utcMidnight(0);
  const daysIntoCurrent = Math.round((todayMidnight.getTime() - monthDay(P0, 1, 0, 0).getTime()) / DAY_MS) + 1;
  const currentDuePassed = dueOn(P0).getTime() < SEED_NOW.getTime();

  const unitIndexOf = new Map(ALL_UNITS.map((unit, index) => [unit.label, index] as const));

  const planned: PlannedPayment[] = [];
  for (const [index, unit] of ALL_UNITS.entries()) {
    const { label } = unit;

    // Two closed periods ago: everybody paid.
    planned.push({ period: P2, label, paidAt: earlyPayInstant(P2, index) });

    // Last month: the delinquent households owe it still; the late payers settled after the 10th.
    if (!DELINQUENT_UNITS.has(label)) {
      planned.push({
        period: P1,
        label,
        paidAt: LATE_PAYER_UNITS.has(label) ? latePayInstant(P1, index) : earlyPayInstant(P1, index),
      });
    }

    // The current month: a handful pay in the first days. If the month is too young for even day
    // two to have passed, nobody has paid yet and the invoices stay open — never a future paidAt.
    const eagerIndex = EAGER_PAYER_UNITS.indexOf(label as (typeof EAGER_PAYER_UNITS)[number]);
    if (eagerIndex >= 0) {
      const payDay = Math.min(2 + (eagerIndex % 4), daysIntoCurrent - 1);
      if (payDay >= 2) {
        planned.push({
          period: P0,
          label,
          paidAt: monthDay(P0, payDay, 1 + (eagerIndex * 5) % 14, (eagerIndex * 17) % 60),
        });
      }
    }
  }

  const paymentFor = new Map<string, PlannedPayment>(
    planned.map((p) => [`${p.period}|${p.label}`, p] as const),
  );

  const invoices = new Map<string, { id: number; amountPaise: number }>();
  for (const period of [P2, P1, P0]) {
    for (const unit of ALL_UNITS) {
      const key = `${period}|${unit.label}`;
      const payment = paymentFor.get(key) ?? null;
      const unitId = unitIdOf(units, unit.label);

      let status: C.InvoiceStatus;
      let cancelledReason: string | null = null;
      if (payment !== null) {
        status = 'PAID';
      } else if (period === P2) {
        // Every unit settled two periods ago by construction.
        throw new Error(`No payment planned for ${unit.label} in ${period}`);
      } else if (period === P1) {
        status = 'OVERDUE';
      } else if (unit.label === 'S-02') {
        status = 'CANCELLED';
        cancelledReason =
          'Shop S-02 was handed back vacant at the end of last month; billed in error before the unit could be paused.';
      } else {
        // What the overdue job would have done by now: the due date is strictly past.
        status = currentDuePassed ? 'OVERDUE' : 'UNPAID';
      }

      const updatedAt =
        payment !== null
          ? payment.paidAt
          : status === 'CANCELLED'
            ? monthDay(P0, 1, 6, 0) // 11:30 IST on the 1st, after the run was reviewed
            : status === 'OVERDUE'
              ? new Date(dueOn(period).getTime() + 30 * HOUR_MS) // the morning after the due date
              : raisedAt(period);

      const row = await db.invoice.upsert({
        where: { unitId_period: { unitId, period } },
        update: {},
        create: {
          unitId,
          raisedById: committeeId,
          period,
          amountPaise: C.rupees(unit.chargeRupees),
          dueOn: dueOn(period),
          status,
          cancelledReason,
          createdAt: raisedAt(period),
          updatedAt,
        },
      });
      invoices.set(key, row);
    }
  }

  let paymentCount = 0;
  for (const period of [P2, P1, P0]) {
    const inPeriod = planned
      .filter((p) => p.period === period)
      .sort(
        (a, b) =>
          a.paidAt.getTime() - b.paidAt.getTime() ||
          (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
      );

    for (const [sequenceMinusOne, p] of inPeriod.entries()) {
      const invoice = invoices.get(`${p.period}|${p.label}`);
      if (invoice === undefined) throw new Error(`No invoice for ${p.label} in ${p.period}`);
      const index = unitIndexOf.get(p.label);
      if (index === undefined) throw new Error(`Seed references unknown unit ${p.label}`);
      const method = methodFor(index);

      await db.payment.upsert({
        where: { reference: paymentReference(p.period, p.label) },
        update: {},
        create: {
          invoiceId: invoice.id,
          recordedById: method === 'CASH' ? committeeId : null, // offline takings, as the desk records them
          amountPaise: invoice.amountPaise,
          method,
          receiptNo: C.receiptNumber(period, sequenceMinusOne + 1),
          reference: paymentReference(p.period, p.label),
          paidAt: p.paidAt,
        },
      });
      paymentCount += 1;
    }

    if (inPeriod.length > 0) {
      // Seeded past the seeded payments so a live payment never collides with a seeded receipt;
      // the empty update means a reseed cannot regress a sequence the desk has already advanced.
      await db.receiptSequence.upsert({
        where: { period },
        update: {},
        create: { period, next: inPeriod.length + 1 },
      });
    }
  }

  return { invoices: invoices.size, payments: paymentCount };
}

/** Deterministic and unique per (period, unit) — the labels are unique across blocks. */
function paymentReference(period: string, label: string): string {
  return `PAYSEED${period.replaceAll('-', '')}${label.replaceAll('-', '')}`;
}

async function seedComplaints(
  db: Db,
  units: ReadonlyMap<string, UnitRow>,
  people: ReadonlyMap<string, PersonRow>,
): Promise<number> {
  let count = 0;
  for (const spec of COMPLAINTS) {
    const unitId = unitIdOf(units, spec.unitLabel);

    // Derived, never hand-repeated: the final status, the resolved stamp a reopen clears, and the
    // reopen count all follow from the trail, exactly as the complaint state machine computes them.
    let resolvedAt: Date | null = null;
    let reopenCount = 0;
    for (const move of spec.trail) {
      if (move.statusAfter === 'RESOLVED') resolvedAt = move.at;
      if (move.statusAfter === 'OPEN') {
        resolvedAt = null;
        reopenCount += 1;
      }
    }
    const lastMove = spec.trail.at(-1);
    const finalStatus: C.ComplaintStatus = lastMove === undefined ? 'OPEN' : lastMove.statusAfter;
    const updatedAt = lastMove === undefined ? spec.raisedAt : lastMove.at;

    const complaint = await ensureRow(
      () => db.complaint.findFirst({ where: { unitId, createdAt: spec.raisedAt } }),
      () =>
        db.complaint.create({
          data: {
            unitId,
            category: spec.category,
            priority: spec.priority,
            description: spec.description,
            photoKeys: '',
            status: finalStatus,
            resolvedAt,
            reopenCount,
            createdAt: spec.raisedAt,
            updatedAt,
          },
        }),
    );

    for (const move of spec.trail) {
      await ensureRow(
        () => db.complaintUpdate.findFirst({ where: { complaintId: complaint.id, createdAt: move.at } }),
        () =>
          db.complaintUpdate.create({
            data: {
              complaintId: complaint.id,
              updatedById: personIdOf(people, move.byEmail),
              statusAfter: move.statusAfter,
              note: move.note,
              createdAt: move.at,
            },
          }),
      );
    }
    count += 1;
  }
  return count;
}

async function seedBookings(
  db: Db,
  units: ReadonlyMap<string, UnitRow>,
  facilities: ReadonlyMap<string, FacilityRow>,
  committeeId: number,
): Promise<number> {
  let count = 0;
  for (const spec of BOOKINGS) {
    const facilityId = facilityIdOf(facilities, spec.facilityName);
    const unitId = unitIdOf(units, spec.unitLabel);
    const bookingDate = utcMidnight(spec.onDay);

    await ensureRow(
      () =>
        db.booking.findFirst({
          where: { facilityId, bookingDate, startTime: spec.start, unitId },
        }),
      async () => {
        const booking = await db.booking.create({
          data: {
            facilityId,
            unitId,
            // PENDING and CONFIRMED rows never share (facility, date, start) — the partial unique
            // index over live bookings holds for the seeded spread too.
            bookingDate,
            startTime: spec.start,
            endTime: spec.end,
            status: spec.status,
            decidedById: spec.decidedAt === null ? null : committeeId,
            decidedAt: spec.decidedAt,
            decisionReason: spec.decisionReason,
            amountPaise: C.rupees(spec.amountRupees),
            createdAt: spec.requestedAt,
            updatedAt: spec.updatedAt,
          },
        });
        // Live seeds hold their hours like any live booking would (D-81): without the hold rows
        // a seeded booking would be overlappable by a new one that starts at a different time.
        if (spec.status === 'PENDING' || spec.status === 'CONFIRMED') {
          await db.bookingSlotHold.createMany({
            data: hoursTouched({ startTime: spec.start, endTime: spec.end }).map((hour) => ({
              bookingId: booking.id,
              facilityId,
              bookingDate,
              startHour: hour,
            })),
          });
        }
        return booking;
      },
    );
    count += 1;
  }
  return count;
}

async function seedNotices(db: Db, committeeId: number): Promise<number> {
  let count = 0;
  for (const notice of NOTICES) {
    await ensureRow(
      () => db.announcement.findFirst({ where: { createdAt: notice.createdAt, title: notice.title } }),
      () =>
        db.announcement.create({
          data: {
            authorId: committeeId,
            title: notice.title,
            body: notice.body,
            category: notice.category,
            pinned: notice.pinned,
            expiresAt: notice.expiresAt,
            createdAt: notice.createdAt,
            updatedAt: notice.createdAt,
          },
        }),
    );
    count += 1;
  }
  return count;
}

async function seedPasses(
  db: Db,
  units: ReadonlyMap<string, UnitRow>,
  people: ReadonlyMap<string, PersonRow>,
): Promise<ReadonlyMap<string, PassRow>> {
  const passes = new Map<string, PassRow>();
  for (const spec of PASSES) {
    const row = await db.visitorPass.upsert({
      where: { code: spec.code },
      update: {},
      create: {
        unitId: unitIdOf(units, spec.unitLabel),
        createdById: personIdOf(people, spec.createdByEmail),
        visitorName: spec.visitorName,
        purpose: spec.purpose,
        code: spec.code,
        validOn: utcMidnight(spec.validOnDay),
        status: spec.status,
        cancelledAt: spec.cancelledAt,
        createdAt: spec.createdAt,
      },
    });
    passes.set(spec.code, row);
  }
  return passes;
}

async function seedGateLogs(
  db: Db,
  units: ReadonlyMap<string, UnitRow>,
  people: ReadonlyMap<string, PersonRow>,
  passes: ReadonlyMap<string, PassRow>,
): Promise<number> {
  let count = 0;

  for (const spec of PASS_LOGS) {
    const pass = passes.get(spec.code);
    if (pass === undefined) throw new Error(`Seed references unknown pass ${spec.code}`);
    await ensureRow(
      () => db.visitorLog.findFirst({ where: { unitId: pass.unitId, createdAt: spec.enteredAt } }),
      () =>
        db.visitorLog.create({
          data: {
            passId: pass.id,
            unitId: pass.unitId,
            walkInName: null,
            walkInPhone: null,
            walkInPurpose: null,
            approvalStatus: 'NOT_REQUIRED',
            decidedById: null,
            decidedAt: null,
            overrideReason: null,
            enteredAt: spec.enteredAt,
            exitedAt: spec.exitedAt,
            idempotencyKey: null,
            createdAt: spec.enteredAt,
          },
        }),
    );
    count += 1;
  }

  for (const spec of WALK_INS) {
    const unitId = unitIdOf(units, spec.unitLabel);
    await ensureRow(
      () => db.visitorLog.findFirst({ where: { unitId, createdAt: spec.createdAt } }),
      () =>
        db.visitorLog.create({
          data: {
            passId: null,
            unitId,
            walkInName: spec.name,
            walkInPhone: spec.phone,
            walkInPurpose: spec.purpose,
            approvalStatus: spec.approvalStatus,
            decidedById: spec.decidedByEmail === null ? null : personIdOf(people, spec.decidedByEmail),
            decidedAt: spec.decidedAt,
            overrideReason: spec.overrideReason,
            // What the product writes: a walk-in row carries the queue state, not gate timestamps.
            enteredAt: null,
            exitedAt: null,
            idempotencyKey: null,
            createdAt: spec.createdAt,
          },
        }),
    );
    count += 1;
  }
  return count;
}

async function seedNotifications(db: Db, people: ReadonlyMap<string, PersonRow>): Promise<number> {
  let count = 0;
  for (const spec of NOTIFICATIONS) {
    const userId = personIdOf(people, spec.toEmail);
    await ensureRow(
      () => db.notification.findFirst({ where: { userId, type: spec.type, createdAt: spec.createdAt } }),
      () =>
        db.notification.create({
          data: {
            userId,
            type: spec.type,
            title: spec.title,
            body: spec.body,
            href: null,
            readAt: spec.readAt,
            createdAt: spec.createdAt,
          },
        }),
    );
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------- the seed

/** What the runner prints: the password the accounts share, and the census. */
export interface SeedReport {
  readonly password: string;
  readonly counts: {
    readonly blocks: number;
    readonly units: number;
    readonly accounts: number;
    readonly facilities: number;
    readonly invoices: number;
    readonly payments: number;
    readonly complaints: number;
    readonly bookings: number;
    readonly notices: number;
    readonly visitorPasses: number;
    readonly gateLogEntries: number;
    readonly notifications: number;
  };
}

export async function seed(db: Db): Promise<SeedReport> {
  const units = await seedProperty(db);
  const people = await seedPeople(db, units);
  const facilities = await seedFacilities(db);
  const committeeId = personIdOf(people, COMMITTEE_EMAIL);

  const billing = await seedBilling(db, units, committeeId);
  const complaints = await seedComplaints(db, units, people);
  const bookings = await seedBookings(db, units, facilities, committeeId);
  const notices = await seedNotices(db, committeeId);
  const passes = await seedPasses(db, units, people);
  const gateLogs = await seedGateLogs(db, units, people, passes);
  const notifications = await seedNotifications(db, people);

  // Nothing is printed here on purpose: the idempotency test calls seed() twice in one process,
  // and the CLI runner below is the only caller whose output is an interface.
  return {
    password: DEMO_PASSWORD,
    counts: {
      blocks: BLOCKS.length,
      units: units.size,
      accounts: PEOPLE.length,
      facilities: facilities.size,
      invoices: billing.invoices,
      payments: billing.payments,
      complaints,
      bookings,
      notices,
      visitorPasses: passes.size,
      gateLogEntries: gateLogs,
      notifications,
    },
  };
}

// ---------------------------------------------------------------- the runner

if (import.meta.filename === process.argv[1]) {
  const db = await getDb();
  const { password, counts } = await seed(db);
  const target = await liveTarget();
  await db.$disconnect();

  const census = [
    `  seeded ${target.label}`,
    '',
    `  blocks            ${counts.blocks}`,
    `  units             ${counts.units}`,
    `  accounts          ${counts.accounts}`,
    `  facilities        ${counts.facilities}`,
    `  invoices          ${counts.invoices}`,
    `  payments          ${counts.payments}`,
    `  complaints        ${counts.complaints}`,
    `  bookings          ${counts.bookings}`,
    `  notices           ${counts.notices}`,
    `  visitor passes    ${counts.visitorPasses}`,
    `  gate log entries  ${counts.gateLogEntries}`,
    `  notifications     ${counts.notifications}`,
  ];
  process.stdout.write(`${census.join('\n')}\n\n`);

  // bootstrap.mjs parses these exact lines ("email  password") and prints them as the sign-in
  // accounts, so only accounts that can actually sign in belong here: the desk, the gate and the
  // resident app. The registration queue cannot authenticate and is not listed.
  const credentials = [
    [COMMITTEE_EMAIL, password],
    [GATE_EMAIL, password],
    ['saarathi@oneresi.in', password],
  ] as const;
  for (const [email, pwd] of credentials) {
    process.stdout.write(`${email.padEnd(28)}${pwd}\n`);
  }
}
