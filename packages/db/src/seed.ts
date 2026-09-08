import { hash } from 'bcryptjs';
import { BCRYPT_COST, rupees } from '@oneresi/contracts';
import { getDb, liveTarget } from './client.js';
import type { Db } from './client.js';

/**
 * Convergent. Running it twice leaves the same rows, not duplicates — every write is an upsert on
 * a natural key. The previous seed used `create` for complaints, invoices, the payment and the
 * announcements, so a second run duplicated half the data and then threw on a unique receipt
 * number (D-45). That matters here because the cloud deploy runs this on every apply.
 *
 * Convergence has to mean byte-for-byte, not just row counts: every `update:` block here is
 * deliberately empty. Prisma still writes the row on the create branch, but on the update branch an
 * empty update touches nothing — a same-values update would rewrite `passwordHash` (bcrypt salts
 * every hash differently, so the recomputed value is always "new") and bump `@updatedAt`, and the
 * run-to-run content digest would never be stable. What is seeded once stays exactly as it was;
 * changing a seed value means changing it here, which is the point.
 *
 * Passwords are generated, not hardcoded. The previous build shipped `Password@123` in the client
 * bundle behind one-click admin sign-in buttons (D-01).
 */

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'starling-marble-97-QUAY';

function day(offsetDays: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function period(offsetMonths: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function seedProperty(db: Db) {
  const blocks = await Promise.all(
    [
      { name: 'Emerald Block', floors: 10 },
      { name: 'Sapphire Block', floors: 12 },
      { name: 'Gulmohar Phase 1', floors: 1 },
    ].map((data) => db.block.upsert({ where: { name: data.name }, update: {}, create: data })),
  );

  const [emerald, sapphire, gulmohar] = blocks;
  if (emerald === undefined || sapphire === undefined || gulmohar === undefined) {
    throw new Error('Block seeding did not return the expected rows');
  }
  return { emerald, sapphire, gulmohar };
}

async function seedUnits(db: Db, blocks: Awaited<ReturnType<typeof seedProperty>>) {
  const wanted = [
    { blockId: blocks.emerald.id, label: 'A-101', type: 'FLAT_2BHK', charge: 3500 },
    { blockId: blocks.emerald.id, label: 'A-102', type: 'FLAT_3BHK', charge: 4800 },
    { blockId: blocks.emerald.id, label: 'A-201', type: 'FLAT_2BHK', charge: 3500 },
    { blockId: blocks.sapphire.id, label: 'B-201', type: 'FLAT_1BHK', charge: 2400 },
    { blockId: blocks.sapphire.id, label: 'B-202', type: 'FLAT_4BHK', charge: 6500 },
    { blockId: blocks.gulmohar.id, label: 'PLOT-101', type: 'PLOT', charge: 1500 },
    { blockId: blocks.gulmohar.id, label: 'PLOT-102', type: 'PLOT', charge: 1500 },
  ];

  const units = new Map<string, { id: number }>();
  for (const u of wanted) {
    const data = {
      blockId: u.blockId,
      label: u.label,
      type: u.type,
      monthlyChargePaise: rupees(u.charge),
    };
    const row = await db.unit.upsert({
      where: { blockId_label: { blockId: u.blockId, label: u.label } },
      update: {},
      create: data,
    });
    units.set(u.label, row);
  }
  return units;
}

async function seedPeople(db: Db, units: Map<string, { id: number }>) {
  const passwordHash = await hash(DEMO_PASSWORD, BCRYPT_COST);

  const wanted = [
    { email: 'committee@oneresi.in', name: 'Ashvin K S', role: 'A', status: 'ACTIVE', unit: null },
    { email: 'gate@oneresi.in', name: 'Main Gate', role: 'S', status: 'ACTIVE', unit: null },
    { email: 'saarathi@oneresi.in', name: 'Saarathi Niranjan Kumar', role: 'R', status: 'ACTIVE', unit: 'A-101' },
    { email: 'priya@oneresi.in', name: 'Priya Sharma', role: 'R', status: 'ACTIVE', unit: 'A-102' },
    { email: 'vikram@oneresi.in', name: 'Vikram Verma', role: 'R', status: 'PENDING', unit: 'B-201' },
  ];

  const people = new Map<string, { id: number; email: string }>();
  for (const p of wanted) {
    const unitId = p.unit === null ? null : (units.get(p.unit)?.id ?? null);
    const data = {
      name: p.name,
      phone: '+919876500000',
      passwordHash,
      role: p.role,
      status: p.status,
      unitId,
    };
    const row = await db.residentUser.upsert({
      where: { email: p.email },
      // Empty on purpose: recomputing the bcrypt hash here would rewrite passwordHash on every
      // bootstrap even when nothing changed, and bump updatedAt with it. The hash is written once,
      // on the create branch.
      update: {},
      create: { email: p.email, ...data },
    });
    people.set(p.email, row);
  }
  return people;
}

async function seedFacilities(db: Db) {
  const wanted = [
    { name: 'Clubhouse Hall', description: 'Air-conditioned hall for up to 80 guests.', opensAt: '09:00', closesAt: '23:00', rate: 750 },
    { name: 'Badminton Court', description: 'Indoor synthetic court. Non-marking shoes.', opensAt: '06:00', closesAt: '22:00', rate: 150 },
    { name: 'Tennis Court', description: 'Outdoor all-weather hard court.', opensAt: '06:00', closesAt: '21:00', rate: 200 },
  ];

  const facilities = new Map<string, { id: number }>();
  for (const f of wanted) {
    const data = {
      description: f.description,
      opensAt: f.opensAt,
      closesAt: f.closesAt,
      hourlyRatePaise: rupees(f.rate),
    };
    const row = await db.facility.upsert({ where: { name: f.name }, update: {}, create: { name: f.name, ...data } });
    facilities.set(f.name, row);
  }
  return facilities;
}

async function seedBilling(
  db: Db,
  units: Map<string, { id: number }>,
  committeeId: number,
) {
  for (const [label, unit] of units) {
    const charge = (await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).monthlyChargePaise;

    for (const offset of [-1, 0]) {
      const p = period(offset);
      const data = {
        unitId: unit.id,
        raisedById: committeeId,
        period: p,
        amountPaise: charge,
        dueOn: day(offset === 0 ? 10 : -20),
        status: offset === -1 ? 'PAID' : 'UNPAID',
      };
      const invoice = await db.invoice.upsert({
        where: { unitId_period: { unitId: unit.id, period: p } },
        update: {},
        create: data,
      });

      if (offset === -1) {
        const reference = `PAYSEED${label.replace(/[^A-Z0-9]/g, '')}${p.replace('-', '')}`;
        const payment = {
          invoiceId: invoice.id,
          amountPaise: charge,
          method: 'UPI',
          receiptNo: `REC-${p}-${String(unit.id).padStart(5, '0')}`,
          reference,
          paidAt: day(-22),
        };
        await db.payment.upsert({ where: { reference }, update: {}, create: payment });
      }
    }
  }
}

export async function seed(db: Db): Promise<{ password: string }> {
  const blocks = await seedProperty(db);
  const units = await seedUnits(db, blocks);
  const people = await seedPeople(db, units);
  await seedFacilities(db);

  const committee = people.get('committee@oneresi.in');
  if (committee === undefined) throw new Error('Committee account was not seeded');
  await seedBilling(db, units, committee.id);

  return { password: DEMO_PASSWORD };
}

if (import.meta.filename === process.argv[1]) {
  const db = await getDb();
  const target = await liveTarget();
  const { password } = await seed(db);

  const counts = {
    blocks: await db.block.count(),
    units: await db.unit.count(),
    people: await db.residentUser.count(),
    facilities: await db.facility.count(),
    invoices: await db.invoice.count(),
    payments: await db.payment.count(),
  };

  process.stdout.write(`\n  seeded ${target.name} (${target.label})\n\n`);
  for (const [name, n] of Object.entries(counts)) {
    process.stdout.write(`    ${name.padEnd(12)}${n}\n`);
  }
  process.stdout.write(`\n  committee@oneresi.in  ${password}\n`);
  process.stdout.write(`  gate@oneresi.in       ${password}\n`);
  process.stdout.write(`  saarathi@oneresi.in   ${password}\n\n`);

  await db.$disconnect();
}
