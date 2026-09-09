import type { NextConfig } from 'next';

/**
 * The marketing site and the committee's desk, plus every API route. Built into the same
 * container image as @oneresi/app; the task's router sends "/" and "/admin/*" here and "/a/*"
 * to the app. See docs/plan/02-architecture.md.
 */
const nextConfig: NextConfig = {
  // The workspace packages export TypeScript source (their package.json "exports" point at
  // ./src/index.ts) and import each other with compiled-style `.js` specifiers — what tsc emits
  // for ESM. Bundler resolution understands the `.js` → `.ts` alias, but webpack (which Next's
  // build uses for these externals) does not apply it outside the app's own directory, so every
  // `./enums.js` inside @oneresi/contracts resolves to nothing. `extensionAlias` teaches webpack
  // the same substitution.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    // `@oneresi/contracts` mixes pure presentation exports (`formatMoney`, descriptor maps) with
    // server-only crypto helpers (`packages/contracts/src/tokens.ts`, which imports `node:crypto`).
    // Any client component that so much as imports the barrel — `Money` does, for `formatMoney` —
    // drags `node:crypto` into a client bundle, and webpack's client compiler refuses the
    // `node:` scheme outright (UnhandledSchemeError) rather than externalising it the way the
    // server compiler does. `resolve.alias` cannot help: enhanced-resolve short-circuits a
    // scheme'd request before aliasing. Rewriting the request in `before-resolve` does work —
    // `crypto` resolves to the same module and stays an external for the server compiler.
    // `webpack` itself is not a direct dependency of this app (no `pnpm install` may be run to
    // add it), so the plugin class comes from Next's own bundled copy, whose module needs one
    // `init()` call before it exposes `webpack`.
    const nextWebpack = require('next/dist/compiled/webpack/webpack.js') as {
      init: () => void;
      webpack: { NormalModuleReplacementPlugin: new (regex: RegExp, replacer: (resource: { request: string }) => void) => unknown };
    };
    nextWebpack.init();
    config.plugins.push(
      new nextWebpack.webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, '');
      }),
    );
    // `packages/db` computes the repository root at module scope with `import.meta.dirname`
    // (packages/db/src/env.ts). Node defines that symbol; the SWC server bundle does not — it
    // lowers the expression to `void 0`, so `path.resolve(undefined, '..')` throws at module
    // evaluation. A `pre` loader rewrites the two `import.meta` file symbols to the source
    // file's real path, which is what Node would have produced. Scoped to workspace package
    // sources — the app itself has no use for these symbols.
    config.module.rules.push({
      test: /\.(ts|tsx|js|mjs)$/,
      include: /[\\/]packages[\\/](contracts|db|domain|mail|ui)[\\/]src[\\/]/,
      use: require.resolve('./src/server/import-meta-loader.js'),
      enforce: 'pre',
    });
    return config;
  },
  // Standalone output is what makes the runtime image small enough to be worth building, and the
  // image is built on Linux (infra/docker/Dockerfile). On Windows it needs directory symlinks the
  // user would have to enable Developer Mode to grant, so local builds take the default output —
  // same app, one less system setting.
  ...(process.platform === 'win32' ? {} : { output: 'standalone' as const }),
};

export default nextConfig;

