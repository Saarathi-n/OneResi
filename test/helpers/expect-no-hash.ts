/**
 * `passwordHash` never leaves the data layer (D-12).
 *
 * The previous build returned the whole user row from sign-in, registration and the admin list, so
 * a bcrypt hash for every account in the society was reachable from the browser — including through
 * `/api/admin/users`, which had no guard at all. `select` and `omit` were the fix; this is how a
 * test proves the fix held, on a response body it did not have to know the shape of.
 *
 * Deliberately shape-based rather than key-based: a hash renamed, nested inside a serialised JSON
 * string, or carried in an array of rows is still a hash.
 */

/** `$2a$`, `$2b$` and `$2y$` are the bcrypt variants in the wild. Cost and salt follow. */
const BCRYPT_SHAPE = /\$2[aby]\$/;

/** Field names that must not appear at all — a blanked hash is still a leaked column. */
const HASH_FIELD = /^(password_?hash|passwordhash|reset_?token_?hash|token_?hash)$/i;

export interface Sighting {
  /** Where it was found, e.g. `body.residents[3].passwordHash`. */
  readonly path: string;
  /** Enough to recognise, not enough to be a hash in a log. */
  readonly preview: string;
}

function preview(value: string): string {
  const at = value.search(BCRYPT_SHAPE);
  return `${value.slice(Math.max(0, at), Math.max(0, at) + 7)}…`;
}

function walk(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  found: Sighting[],
  matchField: boolean,
): void {
  if (typeof value === 'string') {
    if (BCRYPT_SHAPE.test(value)) found.push({ path, preview: preview(value) });
    return;
  }
  if (value === null || typeof value !== 'object') return;

  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Date) return;
  if (value instanceof Uint8Array) {
    walk(Buffer.from(value).toString('utf8'), `${path} (bytes)`, seen, found, matchField);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, seen, found, matchField));
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value)
      walk(item, `${path}.get(${String(key)})`, seen, found, matchField);
    return;
  }
  if (value instanceof Set) {
    let index = 0;
    for (const item of value) {
      walk(item, `${path}#${index}`, seen, found, matchField);
      index += 1;
    }
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const here = `${path}.${key}`;
    if (matchField && HASH_FIELD.test(key)) {
      found.push({ path: here, preview: '<field present>' });
      continue;
    }
    walk(item, here, seen, found, matchField);
  }
}

/** Every bcrypt-shaped string in `value`, however deeply nested. */
export function findPasswordHashes(value: unknown, label = 'body'): readonly Sighting[] {
  const found: Sighting[] = [];
  walk(value, label, new WeakSet(), found, false);
  return found;
}

/** Every field named like a hash column, whatever it holds. */
export function findHashFields(value: unknown, label = 'body'): readonly Sighting[] {
  const found: Sighting[] = [];
  walk(value, label, new WeakSet(), found, true);
  return found.filter((s) => s.preview === '<field present>');
}

function report(what: string, label: string, found: readonly Sighting[]): never {
  const lines = found.map((s) => `    ${s.path}  ${s.preview}`).join('\n');
  throw new Error(`${what} in ${label} (${found.length}):\n${lines}`);
}

/**
 * Fails if a bcrypt-shaped string appears anywhere in `value`.
 *
 * Pass a parsed response body, a raw response text, a Prisma row, or an array of any of those.
 */
export function expectNoHash(value: unknown, label = 'body'): void {
  const found = findPasswordHashes(value, label);
  if (found.length > 0) report('Password hash reached the caller', label, found);
}

/**
 * Fails if a hash column is present at all, even emptied. Stricter than `expectNoHash` and the
 * right assertion for a service return type, where the column should have been omitted rather
 * than blanked.
 */
export function expectNoHashField(value: unknown, label = 'body'): void {
  const found = findHashFields(value, label);
  if (found.length > 0) report('Hash column present', label, found);
}
