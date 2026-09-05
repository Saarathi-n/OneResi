import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One base schema, two providers, and the only difference between the generated files is the
 * datasource and generator block.
 *
 * This is the test that keeps "works locally, 500s on RDS" from coming back (D-15, D-16). The
 * previous build had a 798-line hand-written stand-in for Prisma that accepted unit types the real
 * schema did not, faked transactions and returned unfiltered reads — so the engine you ran against
 * changed the rules. One schema for both engines is what replaces it, and the moment the two
 * outputs diverge beyond their datasource block that guarantee is gone.
 */

const packageRoot = resolve(import.meta.dirname, '..');
const basePath = join(packageRoot, 'prisma', 'schema.base.prisma');

interface Generator {
  readonly PROVIDERS: readonly string[];
  render(provider: string, base?: string): string;
  portablePart(schema: string): string;
  digestOf(schema: string): string;
  assertPortable(base: string): void;
}

// The generator is the script the build runs; loading it by path is the point — a reimplementation
// here would be a second source of truth.
const generator = (await import(
  pathToFileURL(join(packageRoot, 'scripts', 'generate-schemas.mjs')).href
)) as Generator;

const { PROVIDERS, assertPortable, digestOf, portablePart, render } = generator;

const base = readFileSync(basePath, 'utf8');
const onDisk = Object.fromEntries(
  PROVIDERS.map((provider) => [
    provider,
    readFileSync(join(packageRoot, 'prisma', provider, 'schema.prisma'), 'utf8'),
  ]),
) as Record<string, string>;

function schemaFor(provider: string): string {
  const schema = onDisk[provider];
  if (schema === undefined) throw new Error(`No generated schema for ${provider}`);
  return schema;
}

describe('the generated schemas', () => {
  it('exist for exactly the two providers', () => {
    expect([...PROVIDERS]).toEqual(['sqlite', 'postgresql']);
  });

  it('are current — regenerating produces the same bytes', () => {
    for (const provider of PROVIDERS) {
      expect(schemaFor(provider), `${provider}/schema.prisma is stale`).toBe(
        render(provider, base),
      );
    }
  });

  it('are not the same file, so comparing them is not vacuous', () => {
    expect(schemaFor('sqlite')).not.toBe(schemaFor('postgresql'));
    expect(schemaFor('sqlite')).toContain('provider = "sqlite"');
    expect(schemaFor('postgresql')).toContain('provider = "postgresql"');
    expect(schemaFor('sqlite')).not.toContain('__PROVIDER__');
  });

  it('differ only in the datasource and generator blocks', () => {
    expect(portablePart(schemaFor('sqlite'))).toBe(portablePart(schemaFor('postgresql')));
    expect(digestOf(schemaFor('sqlite'))).toBe(digestOf(schemaFor('postgresql')));
  });

  it('carry every model into the portable part, so the comparison covers the models', () => {
    const portable = portablePart(schemaFor('sqlite'));
    for (const model of [
      'model Block',
      'model Unit',
      'model ResidentUser',
      'model VisitorPass',
      'model VisitorLog',
      'model Complaint',
      'model ComplaintUpdate',
      'model Invoice',
      'model Payment',
      'model Facility',
      'model Booking',
      'model Announcement',
      'model OutboxEvent',
      'model MailMessage',
    ]) {
      expect(portable).toContain(model);
    }
    expect(portable).not.toContain('datasource');
    expect(portable).not.toContain('generator');
  });

  it('produce a digest that moves when anything outside those blocks moves', () => {
    const tampered = `${schemaFor('sqlite')}\nmodel Sneaky {\n  id Int @id\n}\n`;
    expect(digestOf(tampered)).not.toBe(digestOf(schemaFor('sqlite')));

    // ...and does not move when only the datasource does.
    const swapped = schemaFor('sqlite').replace('provider = "sqlite"', 'provider = "postgresql"');
    expect(digestOf(swapped)).toBe(digestOf(schemaFor('sqlite')));
  });
});

describe('assertPortable', () => {
  const DATASOURCE = [
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
    'datasource db {',
    '  provider = "sqlite"',
    '  url      = env("DATABASE_URL")',
    '}',
    '',
  ].join('\n');

  const withBody = (body: string) => `${DATASOURCE}${body}\n`;

  it('accepts the real base schema', () => {
    expect(() => assertPortable(base)).not.toThrow();
  });

  it('rejects an enum block, because SQLite has none', () => {
    expect(() => assertPortable(withBody('enum Role {\n  R\n  A\n  S\n}\n'))).toThrow(
      /enum blocks/,
    );
  });

  it('rejects Decimal, because it does not behave the same on both engines', () => {
    expect(() => assertPortable(withBody('model Invoice {\n  amount Decimal\n}\n'))).toThrow(
      /Decimal/,
    );
  });

  it('rejects Json, because SQLite does not have it', () => {
    expect(() => assertPortable(withBody('model OutboxEvent {\n  payload Json\n}\n'))).toThrow(
      /Json/,
    );
  });

  it('rejects an @db.* native type attribute', () => {
    expect(() =>
      assertPortable(withBody('model Unit {\n  label String @db.VarChar(20)\n}\n')),
    ).toThrow(/@db\.\* native type attributes/);
  });

  it('rejects Bytes and PostgreSQL-only scalar lists', () => {
    expect(() => assertPortable(withBody('model Complaint {\n  photo Bytes\n}\n'))).toThrow(
      /Bytes/,
    );
    expect(() => assertPortable(withBody('model Complaint {\n  photoKeys String[]\n}\n'))).toThrow(
      /scalar lists/,
    );
  });

  it('reports every problem at once rather than the first', () => {
    let message = '';
    try {
      assertPortable(withBody('enum Role {\n  R\n}\n\nmodel Invoice {\n  amount Decimal\n}\n'));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/enum blocks/);
    expect(message).toMatch(/Decimal/);
  });

  it('does not trip on a comment that names the construct it forbids', () => {
    // The base schema documents these rules in its own header, which is why the check strips
    // comments before looking. Without that, the file forbidding Decimal would fail its own check.
    expect(() =>
      assertPortable(
        withBody(
          '// no Decimal, no Json, no @db.VarChar, no enum blocks\nmodel Unit {\n  id Int @id\n}\n',
        ),
      ),
    ).not.toThrow();
    expect(base).toContain('no `Decimal`');
  });

  it('accepts the integer-paise money columns the base schema uses instead', () => {
    expect(() => assertPortable(withBody('model Invoice {\n  amountPaise Int\n}\n'))).not.toThrow();
    expect(base).toContain('amountPaise Int');
    expect(base).toContain('monthlyChargePaise Int');
  });
});
