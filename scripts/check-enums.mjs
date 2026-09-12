#!/usr/bin/env node
/**
 * The enumeration gate. Fails the build when a raw enumeration value reaches the DOM.
 *
 * `BHK2`, `PLOT`, `NOT_REQUIRED`, `COMMON_AREA` and `ASSIGNED` all rendered as-is in the previous
 * build, and `StatusBadge` uppercased whatever string it was handed and matched it against four
 * hardcoded lists — so `BHK1`, a unit *type*, was treated as a warning status, and `IN_PROGRESS`
 * fell through to the default blue (D-55).
 *
 * Every enumeration in @grihaone/contracts carries a label map beside it, and rule 2 of
 * docs/plan/WIRING.md says the interface renders that label and never the value. This gate reads
 * the tuples from the contracts source itself, so a new enumeration is covered the moment it is
 * added and there is no second list to maintain.
 *
 *   node scripts/check-enums.mjs
 *   node scripts/check-enums.mjs --self-test
 *   node scripts/check-enums.mjs --list        # what is scanned for, and what is not
 *
 * Scanned: JSX text nodes, the static parts of template literals, and a lone string literal used
 * as a JSX child. Not scanned: attribute values, object keys, `case` labels, Zod schemas — a raw
 * value is correct in all of those, and `<option value="FLAT_2BHK">` must stay raw.
 */
import { readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCOPES, listFiles, locator, maskComments, repoRoot, tokenizeJs } from './check-copy.mjs';

const ENUMS_SOURCE = join(repoRoot, 'packages', 'contracts', 'src', 'enums.ts');
const MARKUP_EXTENSIONS = new Set(['.html', '.htm', '.mjml', '.txt']);

/** Below this length a value is indistinguishable from ordinary prose — ROLES is `R`, `A`, `S`. */
const MIN_VALUE_LENGTH = 3;

// ---------------------------------------------------------------- the enumerations

/**
 * Reads the tuples and label maps out of the contracts source.
 *
 * Preferred path is a real import: Node strips the types and the values come from the same module
 * the application uses. On a Node without type stripping the text parse takes over, because a gate
 * that silently stops finding enumerations is worse than one that is slightly less elegant.
 */
export async function loadEnumerations(source = ENUMS_SOURCE) {
  try {
    const module = await import(pathToFileURL(source).href);
    return { ...collectFromModule(module), how: 'imported' };
  } catch {
    return { ...collectFromText(readFileSync(source, 'utf8')), how: 'parsed' };
  }
}

function isDescriptorMap(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return (
    entries.length > 0 &&
    entries.every((d) => d !== null && typeof d === 'object' && typeof d.label === 'string')
  );
}

function collectFromModule(module) {
  const tuples = new Map();
  const labels = new Map();

  for (const [name, exported] of Object.entries(module)) {
    if (Array.isArray(exported) && exported.every((v) => typeof v === 'string')) {
      tuples.set(name, exported);
    } else if (isDescriptorMap(exported)) {
      for (const [value, descriptor] of Object.entries(exported))
        labels.set(value, descriptor.label);
    }
  }
  return { tuples, labels };
}

function collectFromText(text) {
  const tuples = new Map();
  const labels = new Map();

  for (const match of text.matchAll(/export const ([A-Z0-9_]+)\s*=\s*\[([\s\S]*?)\]\s*as const/g)) {
    const values = [...match[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (values.length > 0) tuples.set(match[1], values);
  }
  for (const match of text.matchAll(
    /export const [A-Z0-9_]+\s*:\s*Descriptors<[^>]*>\s*=\s*\{([\s\S]*?)\n\};/g,
  )) {
    for (const entry of match[1].matchAll(
      /([A-Za-z0-9_.']+)\s*:\s*\{[\s\S]*?label:\s*'([^']*)'/g,
    )) {
      labels.set(entry[1].replaceAll("'", ''), entry[2]);
    }
  }
  return { tuples, labels };
}

/** What the gate looks for, and what it deliberately does not. */
export function targetValues({ tuples, labels }) {
  const wanted = new Map();
  const skipped = [];

  for (const [name, values] of tuples) {
    for (const value of values) {
      if (value.length < MIN_VALUE_LENGTH) {
        skipped.push({ value, name, why: 'too short to tell apart from prose' });
        continue;
      }
      if (labels.get(value) === value) {
        skipped.push({ value, name, why: 'its label is the same text' });
        continue;
      }
      const seen = wanted.get(value);
      if (seen === undefined) wanted.set(value, { value, names: [name], label: labels.get(value) });
      else seen.names.push(name);
    }
  }
  return { wanted, skipped };
}

// ---------------------------------------------------------------- what reaches the DOM

/**
 * A text node has to be anchored on a real tag, not on any `>` that happens to be in the file.
 *
 * The discriminator between `<Badge>` and `Wire<BookingDecidedVars>` is the character before the
 * angle bracket: a generic argument always follows an identifier, a JSX tag never does. Without
 * that check, `export const DECIDED = ['CONFIRMED', 'REJECTED']` sitting between an import's `}`
 * and the next `{` reads as a text node, which is a false positive on correct code.
 */
const TAG_THEN_TEXT =
  /(?<![A-Za-z0-9_$.])<\/?[A-Za-z][A-Za-z0-9.:_-]*(?:\s[^<>]*?)?\/?>([^<>{}`]*)(?=[<{}])/g;
/** The same, for a fragment: `<>text</>`. */
const FRAGMENT_THEN_TEXT = /(?<![A-Za-z0-9_$.])<\/?>([^<>{}`]*)(?=[<{}])/g;
/** Text that follows an interpolation — `<p>Status: {name} — CLOSED</p>`. */
const EXPR_THEN_TEXT = /\}([^<>{}`]*?)(?=<\/|(?<![A-Za-z0-9_$.])<[A-Za-z>])/g;
/** `<span>{'FLAT_2BHK'}</span>` — a string literal standing in for a text node. */
const LONE_STRING_CHILD = />\s*\{\s*(['"])([^'"\n]*)\1\s*\}\s*</g;

/**
 * Every run of characters in `source` that a browser or a mail client renders verbatim, with the
 * absolute offset each one starts at.
 */
export function domChunks(source, { markup = false } = {}) {
  const chunks = [];
  const masked = maskComments(source, { markup });

  const collect = (pattern, group = 1) => {
    for (const match of masked.matchAll(pattern)) {
      const text = match[group];
      if (text === undefined || text.trim() === '') continue;
      chunks.push({ offset: match.index + match[0].length - text.length, text });
    }
  };

  if (!markup) {
    for (const chunk of tokenizeJs(source).templateChunks) chunks.push(chunk);
    for (const match of masked.matchAll(LONE_STRING_CHILD)) {
      if (match[2] === undefined || match[2].trim() === '') continue;
      chunks.push({ offset: match.index + match[0].indexOf(match[2]), text: match[2] });
    }
  }
  collect(TAG_THEN_TEXT);
  collect(FRAGMENT_THEN_TEXT);
  collect(EXPR_THEN_TEXT);
  return chunks;
}

/**
 * True when the occurrence stands alone rather than sitting inside a longer identifier, a unit
 * label like `PLOT-101`, or a quoted string that happens to fall inside a scanned run.
 */
function standsAlone(text, at, value) {
  const before = at === 0 ? '' : text[at - 1];
  const after = text[at + value.length] ?? '';
  return !/[A-Za-z0-9_.\-'"]/.test(before) && !/[A-Za-z0-9_.\-'"]/.test(after);
}

export function scanSource(source, wanted, { markup = false } = {}) {
  const where = locator(source);
  const seen = new Set();
  const findings = [];

  for (const chunk of domChunks(source, { markup })) {
    for (const target of wanted.values()) {
      let at = chunk.text.indexOf(target.value);
      while (at !== -1) {
        const offset = chunk.offset + at;
        if (standsAlone(chunk.text, at, target.value) && !seen.has(`${offset}:${target.value}`)) {
          seen.add(`${offset}:${target.value}`);
          findings.push({ ...where(offset), ...target });
        }
        at = chunk.text.indexOf(target.value, at + 1);
      }
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

// ---------------------------------------------------------------- running

const out = (line = '') => process.stdout.write(`${line}\n`);

export async function checkEnums(scopes = SCOPES) {
  const enumerations = await loadEnumerations();
  const { wanted, skipped } = targetValues(enumerations);
  const files = listFiles(scopes);
  const findings = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const markup = MARKUP_EXTENSIONS.has(extname(file));
    const path = relative(repoRoot, file).replaceAll('\\', '/');
    for (const finding of scanSource(source, wanted, { markup }))
      findings.push({ path, ...finding });
  }

  return { how: enumerations.how, tuples: enumerations.tuples, wanted, skipped, files, findings };
}

function report({ how, tuples, wanted, files, findings }) {
  out();
  out('  enumeration gate');
  out();

  for (const f of findings) {
    const label = f.label === undefined ? 'its label map' : `"${f.label}"`;
    out(`  ${f.path}:${f.line}:${f.column}  ${f.value}`);
    out(`      ${f.names[0]} — render ${label} instead (D-55)`);
  }
  if (findings.length > 0) out();

  if (files.length === 0) {
    out(`  ${wanted.size} values from ${tuples.size} enumerations (${how}), nothing to scan yet.`);
    out('  Expected until the interface streams land. The gate is wired and self-tested.');
    out();
    return 0;
  }

  out(
    findings.length === 0
      ? `  clean — ${files.length} files scanned for ${wanted.size} values from ${tuples.size} enumerations (${how})`
      : `  ${findings.length} raw value${findings.length === 1 ? '' : 's'} in ${files.length} files scanned`,
  );
  out();
  return findings.length === 0 ? 0 : 1;
}

async function list() {
  const { tuples, labels, how } = await loadEnumerations();
  const { wanted, skipped } = targetValues({ tuples, labels });

  out();
  out(`  ${tuples.size} enumerations, ${how} from packages/contracts/src/enums.ts`);
  out();
  for (const [name, values] of tuples) {
    const unlabelled = values.filter((v) => !labels.has(v));
    const note = unlabelled.length === values.length ? '  (no label map)' : '';
    out(`  ${name.padEnd(24)}${values.length} values${note}`);
  }
  out();
  out(`  ${wanted.size} values are scanned for. ${skipped.length} are not:`);
  for (const s of skipped) out(`    ${s.value.padEnd(16)}${s.name} — ${s.why}`);
  out();
  return 0;
}

// ---------------------------------------------------------------- self test

const FIXTURES = [
  {
    why: 'a label map read',
    ext: '.tsx',
    source: '<span>{COMPLAINT_STATUS[status].label}</span>',
    findings: 0,
  },
  { why: 'a raw status as text', ext: '.tsx', source: '<span>IN_PROGRESS</span>', findings: 1 },
  {
    why: 'a raw status inside a badge',
    ext: '.tsx',
    source: '<Badge tone="critical">CANCELLED</Badge>',
    findings: 1,
  },
  { why: 'a raw approval status', ext: '.tsx', source: '<p>NOT_REQUIRED</p>', findings: 1 },
  { why: 'a raw category', ext: '.tsx', source: '<li>COMMON_AREA</li>', findings: 1 },
  {
    why: 'a raw value as a lone string child',
    ext: '.tsx',
    source: "<div>{'FLAT_2BHK'}</div>",
    findings: 1,
  },
  {
    why: 'a raw value after an interpolation',
    ext: '.tsx',
    source: '<p>Status: {name} — CLOSED</p>',
    findings: 1,
  },
  {
    why: 'a raw value in a template literal',
    ext: '.ts',
    source: 'const s = `Priority: URGENT`;',
    findings: 1,
  },
  {
    why: 'a raw value in a mail template body',
    ext: '.ts',
    source: 'const html = `<td>OVERDUE</td>`;',
    findings: 1,
  },
  {
    why: 'a label in a template literal',
    ext: '.ts',
    source: 'const s = `Priority: ${COMPLAINT_PRIORITY[p].label}`;',
    findings: 0,
  },
  {
    why: 'an attribute value, which must stay raw',
    ext: '.tsx',
    source: '<option value="FLAT_2BHK">2 BHK</option>',
    findings: 0,
  },
  {
    why: 'a case label, which is code',
    ext: '.ts',
    source: "switch (s) { case 'IN_PROGRESS': break; }",
    findings: 0,
  },
  {
    why: 'an object key, which is code',
    ext: '.ts',
    source: "const m = { OPEN: 'Reported', CLOSED: 'Closed' };",
    findings: 0,
  },
  {
    why: 'a comment naming the value',
    ext: '.ts',
    source: '// IN_PROGRESS per docs/data-model.md\nconst a = 1;',
    findings: 0,
  },
  {
    why: 'a unit label that starts with a type',
    ext: '.tsx',
    source: '<td>PLOT-101</td>',
    findings: 0,
  },
  {
    why: 'the display label itself',
    ext: '.tsx',
    source: '<td>Plot</td><td>Being fixed</td>',
    findings: 0,
  },
  { why: 'a value whose label is the same text', ext: '.tsx', source: '<td>UPI</td>', findings: 0 },
  {
    why: 'a single-letter role in prose',
    ext: '.tsx',
    source: '<p>A resident may book one slot. S is not a role you type.</p>',
    findings: 0,
  },
  {
    why: 'ordinary product copy',
    ext: '.tsx',
    source: '<h1>Visitor pass</h1><p>Show this code at the gate.</p>',
    findings: 0,
  },
  { why: 'an html mail body', ext: '.html', source: '<tr><td>URGENT</td></tr>', findings: 1 },
  {
    why: 'an html mail body using the label',
    ext: '.html',
    source: '<tr><td>Urgent</td></tr>',
    findings: 0,
  },
  {
    why: 'two raw values on one line',
    ext: '.tsx',
    source: '<p>OVERDUE</p><p>NETBANKING</p>',
    findings: 2,
  },
];

async function selfTest() {
  const { wanted } = targetValues(await loadEnumerations());
  out();
  out('  enumeration gate — self test');
  out();
  let failed = 0;

  for (const fixture of FIXTURES) {
    const markup = MARKUP_EXTENSIONS.has(fixture.ext);
    const findings = scanSource(fixture.source, wanted, { markup });
    const ok = findings.length === fixture.findings;
    if (!ok) failed += 1;
    out(`  ${ok ? 'pass' : 'FAIL'}  ${fixture.why}`);
    if (!ok) {
      out(`        expected ${fixture.findings}, received ${findings.length}`);
      for (const f of findings) out(`        matched ${f.value} at ${f.line}:${f.column}`);
    }
  }

  out();
  out(
    failed === 0
      ? `  ${FIXTURES.length} fixtures, all as expected`
      : `  ${failed} of ${FIXTURES.length} fixtures wrong`,
  );
  out();
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = process.argv.includes('--self-test')
    ? await selfTest()
    : process.argv.includes('--list')
      ? await list()
      : report(await checkEnums());
  process.exit(code);
}
