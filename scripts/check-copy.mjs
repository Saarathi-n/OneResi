#!/usr/bin/env node
/**
 * The copy gate. Fails the build when coursework framing reaches anything a user reads.
 *
 * The previous build printed requirement identifiers on its buttons — "Cancel Slot (UC-12)",
 * "GATE APPROVAL REQUIRED (UC-05)", "Simulated Online Payment (ADR 0002)" — in roughly 75 places
 * across three pages and six email subject lines, told the resident "Coursework Simulation:
 * processes the settlement in-process", labelled a form field "Select Seeded Unit" and left "Try
 * 492815" as a permanent button in the gate kiosk (D-51, D-52, D-53, D-54).
 *
 * A security guard at a gate should not see requirement identifiers. Every one of those strings
 * belongs in a code comment or in docs/, so this gate reads only what survives after comments are
 * removed, and citing a defect in a comment is encouraged rather than punished.
 *
 *   node scripts/check-copy.mjs
 *   node scripts/check-copy.mjs --self-test     # proves the scanner can still fail
 *
 * Escape hatch, for the rare string that has to keep a forbidden word:
 *
 *   const label = 'Seeded'; // copy-gate-allow: shown only in the dev console at /dev/mail
 *
 * The reason is mandatory and is printed in the summary, so an allowance is visible rather than
 * silent. A directive covers its own line and the line after it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Where user-visible copy lives. Nothing else is scanned; docs and comments are the place for it. */
export const SCOPES = [
  { segments: ['apps', '*', 'src'], what: 'application source' },
  { segments: ['packages', 'ui', 'src'], what: 'design system' },
  { segments: ['packages', 'mail', 'src', 'templates'], what: 'mail templates' },
];

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const MARKUP_EXTENSIONS = new Set(['.html', '.htm', '.mjml', '.txt']);

/**
 * Identifiers are matched case sensitively — they only exist in one case. The words are matched
 * case insensitively, because docs/plan/WIRING.md rule 1 forbids them in lower case too and D-54
 * quotes "marked as PAID via simulated transaction" from the previous build.
 */
export const PATTERNS = [
  { name: 'use-case identifier', pattern: /UC-\d{2}/g, defect: 'D-51' },
  { name: 'decision record', pattern: /ADR[- ]?\d{4}/g, defect: 'D-51' },
  {
    // Defect-register numbers leaked through once as "(D-04)" beside a button label — same
    // defect as the use-case identifiers, different token. Exactly two digits: the register
    // numbers are D-01..D-80, while a flat label in a block named D reads "D-402", which
    // must not trip this.
    name: 'defect-register number',
    pattern: /\bD-\d{2}\b/g,
    defect: 'D-51',
  },
  { name: 'course code', pattern: /BCSE\d+/g, defect: 'D-53' },
  { name: 'register number', pattern: /24BCE\d+/g, defect: 'D-53' },
  { name: 'seeded data', pattern: /Seeded/gi, defect: 'D-53' },
  { name: 'demo credentials', pattern: /Demo Credentials/gi, defect: 'D-53' },
  { name: 'coursework framing', pattern: /Coursework/gi, defect: 'D-52' },
  { name: 'simulation', pattern: /Simulat(?:ed|ion)/gi, defect: 'D-54' },
  { name: 'mock', pattern: /\bMock\b/gi, defect: 'D-51' },
];

const ALLOW = /copy-gate-allow\s*:?([^\n*]*)/;
const MIN_REASON = 8;

// ---------------------------------------------------------------- finding files

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (
      CODE_EXTENSIONS.has(extname(entry.name)) ||
      MARKUP_EXTENSIONS.has(extname(entry.name))
    ) {
      yield full;
    }
  }
}

/** Expands the one `*` a scope may contain, so `apps/*` picks up every application. */
export function scopeRoots(scopes = SCOPES) {
  const roots = [];
  for (const scope of scopes) {
    const star = scope.segments.indexOf('*');
    if (star === -1) {
      roots.push({ dir: join(repoRoot, ...scope.segments), what: scope.what });
      continue;
    }
    const parent = join(repoRoot, ...scope.segments.slice(0, star));
    let entries = [];
    try {
      entries = readdirSync(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      roots.push({
        dir: join(parent, entry.name, ...scope.segments.slice(star + 1)),
        what: scope.what,
      });
    }
  }
  return roots.filter((root) => existsSync(root.dir));
}

export function listFiles(scopes = SCOPES) {
  const files = [];
  for (const root of scopeRoots(scopes)) {
    for (const file of walk(root.dir)) files.push(file);
  }
  return files.sort();
}

// ---------------------------------------------------------------- removing comments

/**
 * Positions where a quote really opens a string literal. Everything else is treated as ordinary
 * text, which is the safe direction: text still gets scanned, so a violation cannot hide there.
 * The unsafe direction is entering a string that never ends, because then a real `//` further down
 * the line stops being recognised as a comment.
 */
const BEFORE_STRING = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', ';', '+', '{']);
const BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', ';', '+', '{', '}']);
const KEYWORD_BEFORE =
  /(?:^|[^A-Za-z0-9_$])(return|throw|case|typeof|instanceof|in|of|delete|void|await|yield|from|as|default|extends|new)[\s(]*$/;

function opensLiteral(source, index, previous, allowed) {
  if (allowed.has(previous)) return true;
  // `() => 'x'`, but not a JSX closing angle bracket.
  if (previous === '>' && /=>[\s]*$/.test(source.slice(Math.max(0, index - 8), index))) return true;
  return KEYWORD_BEFORE.test(source.slice(Math.max(0, index - 24), index));
}

/**
 * Returns the source with every comment replaced by spaces, keeping every other character and
 * every newline exactly where it was, so a match position still maps to the original line.
 *
 * String and template literals are tracked but kept — they are the copy this gate is about. HTML
 * and text files get `<!-- -->` removed and nothing else, because an apostrophe in prose must not
 * be read as a string delimiter.
 */
export function maskComments(source, { markup = false } = {}) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };

  if (markup) {
    for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
      blank(match.index, match.index + match[0].length);
    }
    return out.join('');
  }

  return tokenizeJs(source).masked;
}

/**
 * The same pass, returning what it found rather than only the masked text. `templateChunks` holds
 * the static runs of every template literal — the parts that reach the DOM verbatim — each with
 * its absolute offset, which is what scripts/check-enums.mjs scans.
 */
export function tokenizeJs(source) {
  const out = source.split('');
  const templateChunks = [];
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };

  const stack = [];
  let mode = 'code';
  let previous = '';
  let chunkStart = -1;
  let i = 0;

  const endChunk = (at) => {
    if (chunkStart !== -1 && at > chunkStart) {
      templateChunks.push({ offset: chunkStart, text: source.slice(chunkStart, at) });
    }
    chunkStart = -1;
  };

  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];

    if (mode === 'template') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        endChunk(i);
        stack.pop();
        mode = 'code';
        i += 1;
        continue;
      }
      if (c === '$' && d === '{') {
        endChunk(i);
        stack.push('expression');
        mode = 'code';
        i += 2;
        continue;
      }
      if (chunkStart === -1) chunkStart = i;
      i += 1;
      continue;
    }

    if (c === '/' && d === '/') {
      const end = source.indexOf('\n', i);
      const to = end === -1 ? source.length : end;
      blank(i, to);
      i = to;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2);
      const to = end === -1 ? source.length : end + 2;
      blank(i, to);
      i = to;
      continue;
    }
    if (c === '`') {
      stack.push('template');
      mode = 'template';
      previous = '`';
      i += 1;
      continue;
    }
    if (c === '}' && stack[stack.length - 1] === 'expression') {
      stack.pop();
      mode = 'template';
      i += 1;
      continue;
    }
    if ((c === '"' || c === "'") && opensLiteral(source, i, previous, BEFORE_STRING)) {
      i = skipQuoted(source, i, c);
      previous = c;
      continue;
    }
    if (c === '/' && opensLiteral(source, i, previous, BEFORE_REGEX)) {
      i = skipRegex(source, i);
      previous = '/';
      continue;
    }

    if (!/\s/.test(c)) previous = c;
    i += 1;
  }

  endChunk(source.length);
  return { masked: out.join(''), templateChunks };
}

/** A quoted string ends at its closing quote or at the newline, because JavaScript's does too. */
function skipQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === '\n') return i;
    i += 1;
  }
  return i;
}

function skipRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return i;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i + 1;
    i += 1;
  }
  return i;
}

// ---------------------------------------------------------------- scanning

/** Byte offset to 1-based line and column. */
export function locator(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
}

/** Allowances, read from the raw source because the directive itself lives in a comment. */
export function readAllowances(source) {
  const covered = new Map();
  const reasonless = [];
  const lines = source.split('\n');

  lines.forEach((text, index) => {
    if (!text.includes('copy-gate-allow')) return;
    const reason = (ALLOW.exec(text)?.[1] ?? '').replace(/[*/]+\s*$/, '').trim();
    if (reason.length < MIN_REASON) {
      reasonless.push({ line: index + 1, reason });
      return;
    }
    // Its own line, and the line after — so the directive works above the string or beside it.
    covered.set(index + 1, reason);
    covered.set(index + 2, reason);
  });

  return { covered, reasonless };
}

export function scanSource(source, { markup = false } = {}) {
  const masked = maskComments(source, { markup });
  const where = locator(source);
  const { covered, reasonless } = readAllowances(source);

  const violations = [];
  const allowed = [];

  for (const { name, pattern, defect } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const { line, column } = where(match.index);
      const finding = { line, column, match: match[0], name, defect };
      const reason = covered.get(line);
      if (reason === undefined) violations.push(finding);
      else allowed.push({ ...finding, reason });
    }
  }

  violations.sort((a, b) => a.line - b.line || a.column - b.column);
  return { violations, allowed, reasonless };
}

// ---------------------------------------------------------------- running

const out = (line = '') => process.stdout.write(`${line}\n`);

export function checkCopy(scopes = SCOPES) {
  const files = listFiles(scopes);
  const violations = [];
  const allowed = [];
  const reasonless = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const markup = MARKUP_EXTENSIONS.has(extname(file));
    const result = scanSource(source, { markup });
    const path = relative(repoRoot, file).replaceAll('\\', '/');
    for (const v of result.violations) violations.push({ path, ...v });
    for (const a of result.allowed) allowed.push({ path, ...a });
    for (const r of result.reasonless) reasonless.push({ path, ...r });
  }

  return { files, violations, allowed, reasonless };
}

function report({ files, violations, allowed, reasonless }) {
  out();
  out('  copy gate');
  out();

  for (const v of violations) {
    out(`  ${v.path}:${v.line}:${v.column}  ${v.match}`);
    out(`      ${v.name} (${v.defect}) — move it to a comment or docs/`);
  }
  for (const r of reasonless) {
    out(
      `  ${r.path}:${r.line}  copy-gate-allow needs a reason of at least ${MIN_REASON} characters`,
    );
  }
  if (violations.length > 0 || reasonless.length > 0) out();

  for (const a of allowed) {
    out(`  allowed  ${a.path}:${a.line}  ${a.match} — ${a.reason}`);
  }
  if (allowed.length > 0) out();

  if (files.length === 0) {
    out('  nothing to scan yet: no apps/*/src, packages/ui/src or packages/mail/src/templates.');
    out('  Expected until the interface streams land. The gate is wired and self-tested.');
    out();
    return 0;
  }

  const failures = violations.length + reasonless.length;
  out(
    failures === 0
      ? `  clean — ${files.length} file${files.length === 1 ? '' : 's'} scanned, ${allowed.length} allowed`
      : `  ${failures} problem${failures === 1 ? '' : 's'} in ${files.length} files scanned`,
  );
  out();
  return failures === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- self test
//
//  D-75 was a test suite that could not fail. A gate that scans nothing and exits 0 is the same
//  thing, and until the interface streams land this gate scans nothing — so it carries fixtures
//  and can be asked to prove it still bites.

const FIXTURES = [
  {
    why: 'identifier in a heading',
    ext: '.tsx',
    source: '<h1>Registration Verification (UC-19)</h1>',
    violations: 1,
  },
  {
    why: 'identifier in a line comment',
    ext: '.tsx',
    source: '// closes UC-19 and UC-05\nconst a = 1;',
    violations: 0,
  },
  {
    why: 'identifier in a block comment',
    ext: '.ts',
    source: '/**\n * Implements UC-21 (ADR 0002).\n */\nexport const a = 1;',
    violations: 0,
  },
  {
    why: 'identifier in a JSX comment',
    ext: '.tsx',
    source: '<div>{/* UC-12 */}</div>',
    violations: 0,
  },
  {
    why: 'a URL does not blank the rest of the line',
    ext: '.ts',
    source: "const l = 'https://grihaone.in/x'; const t = 'Seeded';",
    violations: 1,
  },
  {
    why: 'simulated payment button',
    ext: '.tsx',
    source: "<button>{'Pay Now (Simulated)'}</button>",
    violations: 1,
  },
  {
    why: 'lower-case simulation in prose',
    ext: '.tsx',
    source: '<p>marked as PAID via simulated transaction</p>',
    violations: 1,
  },
  { why: 'mock as a whole word', ext: '.ts', source: "const t = 'Mock store';", violations: 1 },
  {
    why: 'mock inside another word',
    ext: '.ts',
    source: "const t = 'Mockingbird mockup';",
    violations: 0,
  },
  {
    why: 'an apostrophe does not hide what follows',
    ext: '.tsx',
    source: "<p>don't open UC-12 here</p>",
    violations: 1,
  },
  {
    why: 'template literal',
    ext: '.ts',
    source: 'const s = `Maintenance Invoice (UC-21)`;',
    violations: 1,
  },
  {
    why: 'template literal with an expression',
    ext: '.ts',
    source: 'const s = `Notice ${title} — Coursework`;',
    violations: 1,
  },
  {
    why: 'a regex holding quotes',
    ext: '.ts',
    source: "const re = /['\"]/g; const s = 'ADR 0002';",
    violations: 1,
  },
  {
    why: 'all three ADR spellings',
    ext: '.ts',
    source: "const a = 'ADR-0003'; const b = 'ADR 0002'; const c = 'ADR0004';",
    violations: 3,
  },
  {
    why: 'defect-register number beside a button',
    ext: '.tsx',
    source: '<button>Resend code (D-04)</button>',
    violations: 1,
  },
  {
    why: 'a flat label in block D is not a defect number',
    ext: '.tsx',
    source: "<p>{'Your home: D-402, Palm Villas'}</p>",
    violations: 0,
  },
  {
    why: 'course code and register number',
    ext: '.tsx',
    source: '<footer>BCSE301L · 24BCE1580</footer>',
    violations: 2,
  },
  {
    why: 'seeded unit as a form label',
    ext: '.tsx',
    source: '<label>Select Seeded Unit</label>',
    violations: 1,
  },
  { why: 'demo credentials', ext: '.tsx', source: '<p>Demo Credentials Active</p>', violations: 1 },
  {
    why: 'an allowance beside the string',
    ext: '.ts',
    source: "const s = 'Seeded'; // copy-gate-allow: dev console only, stripped in production",
    violations: 0,
    allowed: 1,
  },
  {
    why: 'an allowance above the string',
    ext: '.ts',
    source:
      "// copy-gate-allow: dev console only, stripped in production\nconst s = 'Demo Credentials';",
    violations: 0,
    allowed: 1,
  },
  {
    why: 'an allowance without a reason grants nothing',
    ext: '.ts',
    source: "const s = 'Seeded'; // copy-gate-allow",
    violations: 1,
    reasonless: 1,
  },
  {
    why: 'an allowance with a token reason grants nothing',
    ext: '.ts',
    source: "const s = 'Seeded'; // copy-gate-allow: x",
    violations: 1,
    reasonless: 1,
  },
  {
    why: 'html comment',
    ext: '.html',
    source: '<!-- UC-24 -->\n<td>September notice</td>',
    violations: 0,
  },
  {
    why: 'html body',
    ext: '.html',
    source: "<td>Don't miss it — Coursework Simulation</td>",
    violations: 2,
  },
  {
    why: 'mail subject in a template',
    ext: '.ts',
    source: "export const subject = 'GrihaOne - Maintenance Invoice for 2026-09 (UC-21)';",
    violations: 1,
  },
  {
    why: 'clean product copy',
    ext: '.tsx',
    source:
      '<h1>Visitor pass</h1>\n<p>Show this code at the gate.</p>\n<button>Pay ₹3,500</button>',
    violations: 0,
  },
];

function selfTest() {
  out();
  out('  copy gate — self test');
  out();
  let failed = 0;

  for (const fixture of FIXTURES) {
    const markup = MARKUP_EXTENSIONS.has(fixture.ext);
    const result = scanSource(fixture.source, { markup });
    const got = {
      violations: result.violations.length,
      allowed: result.allowed.length,
      reasonless: result.reasonless.length,
    };
    const want = {
      violations: fixture.violations,
      allowed: fixture.allowed ?? 0,
      reasonless: fixture.reasonless ?? 0,
    };
    const ok =
      got.violations === want.violations &&
      got.allowed === want.allowed &&
      got.reasonless === want.reasonless;

    if (!ok) failed += 1;
    out(`  ${ok ? 'pass' : 'FAIL'}  ${fixture.why}`);
    if (!ok) {
      out(`        expected ${JSON.stringify(want)}`);
      out(`        received ${JSON.stringify(got)}`);
      for (const v of result.violations) out(`        matched ${v.match} at ${v.line}:${v.column}`);
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
  process.exit(process.argv.includes('--self-test') ? selfTest() : report(checkCopy()));
}
