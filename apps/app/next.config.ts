import type { NextConfig } from 'next';

/**
 * The installable PWA — residents and the gate. Served under /a/ from the same container image
 * as @oneresi/web, which is also where the service worker's scope ends: the marketing site must
 * never land in the offline cache. See docs/plan/02-architecture.md.
 */
const nextConfig: NextConfig = {
  basePath: '/a',
  webpack: (config) => {
    // The workspace packages export TypeScript source (their package.json "exports" point at
    // ./src/index.ts) and import each other with compiled-style `.js` specifiers — what tsc emits
    // for ESM. Bundler resolution understands the `.js` → `.ts` alias, but webpack (which Next's
    // build uses for these externals) does not apply it outside the app's own directory, so every
    // `./enums.js` inside @oneresi/contracts resolves to nothing. `extensionAlias` teaches webpack
    // the same substitution. Same fix as apps/web/next.config.ts.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    // `@oneresi/contracts` mixes pure presentation exports (`formatMoney`, descriptor maps) with
    // server-only crypto helpers (`packages/contracts/src/tokens.ts`, which imports `node:crypto`).
    // A client component that so much as imports the barrel — `Money` does, for `formatMoney` —
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
      webpack: {
        NormalModuleReplacementPlugin: new (
          regex: RegExp,
          replacer: (resource: { request: string }) => void,
        ) => unknown;
      };
    };
    nextWebpack.init();
    config.plugins.push(
      new nextWebpack.webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, '');
      }),
    );
    return config;
  },
  // Standalone output is what makes the runtime image small enough to be worth building, and the
  // image is built on Linux (infra/docker/Dockerfile). On Windows it needs directory symlinks the
  // user would have to enable Developer Mode to grant, so local builds take the default output —
  // same app, one less system setting.
  ...(process.platform === 'win32' ? {} : { output: 'standalone' as const }),
};

export default nextConfig;
