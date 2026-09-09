/**
 * A webpack `enforce: 'pre'` loader, wired in next.config.ts.
 *
 * `packages/db` computes the repository root at module scope with `import.meta.dirname`
 * (packages/db/src/env.ts:26). Node defines that symbol, but Next's SWC pass lowers the server
 * bundle to CommonJS, where `import.meta` does not exist — the expression compiles to
 * `void 0`, and `path.resolve(undefined, '..')` throws at module evaluation (build fails during
 * "collect page data"; a dev-server first request fails the same way).
 *
 * This loader runs BEFORE SWC on the raw TypeScript of the workspace packages and replaces the
 * two `import.meta` file symbols with the loader's own resource path — exactly the values Node
 * would have produced for the source file, so `repoRoot` lands on the real repository root.
 *
 * Scope is limited to the workspace packages' sources (the `include` regex in next.config.ts);
 * app code has no reason to use these symbols, and app files keep Next's own handling.
 */
import path from 'node:path';

/** @param {string} source */
export default function importMetaLoader(source) {
  if (!source.includes('import.meta.')) return source;
  return source
    .replaceAll('import.meta.dirname', JSON.stringify(path.dirname(this.resourcePath)))
    .replaceAll('import.meta.filename', JSON.stringify(this.resourcePath));
}
