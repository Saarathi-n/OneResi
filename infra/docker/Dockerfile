# syntax=docker/dockerfile:1
#
# OneResi — one image, two front ends, and a second target that carries the migration toolchain.
#
# The previous deployment had no Dockerfile at all. Its task definition pointed at `node:20-alpine`
# with the comment "Default or your ECR URI", so the container started, found no application, exited,
# and ECS restarted it forever (D-09).
#
# ── `apps/` does not exist yet ────────────────────────────────────────────────────────────────────
# The two Next.js applications are another stream's work and are not in the repository at the time this
# file was written. Everything below is therefore generic over the pnpm workspace: it installs whatever
# `pnpm-workspace.yaml` declares, runs `build` in every package that has one, and collects the
# standalone output of every `apps/*` that produced one. It builds correctly with zero, one or two
# applications present, and needs no edit when they land — only `output: 'standalone'` in each app's
# `next.config`, which is what makes the runtime image small enough to be worth building.
#
# Two targets:
#   --target runtime   the service. Standalone output only, no toolchain, non-root.
#   --target migrate   the one-off ECS task. Keeps the workspace, the Prisma CLI and the seed.
#
# `terraform output docker_commands` prints both build and push commands with the right tags.

########################################################################################################
# base — pnpm, and the two libraries Prisma's engine needs on Alpine
########################################################################################################
FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat openssl

ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
# Corepack caches the pnpm version pinned in the root package.json here rather than in root's home
# directory, so the migrate stage can use it as an unprivileged user without downloading it again.
ENV COREPACK_HOME=/pnpm/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true

RUN corepack enable

WORKDIR /build

########################################################################################################
# build — install, generate the Prisma clients, build every app, collect the standalone output
########################################################################################################
FROM base AS build

# The whole workspace in one layer. Once `apps/` exists and CI build time starts to matter, splitting
# the manifests out first (`COPY --parents '**/package.json' ./`) is the one-line improvement that makes
# the install layer cache — it is left out for now because the file list it depends on does not exist.
COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Emits the SQLite and PostgreSQL schema variants from `schema.base.prisma` and generates both clients.
# The image only ever uses the PostgreSQL one — DB_TARGET is cloud here — but generating both keeps the
# image and the local checkout identical.
RUN pnpm --filter @oneresi/db generate

# Recursive run skips packages with no `build` script, so this works before the apps exist.
RUN pnpm run -r build

# Assemble /out from whatever was built. A shell loop rather than a COPY per app, because a COPY of a
# path that does not exist is a build failure and `apps/` is not here yet.
#
# Next's standalone output already carries the traced subset of node_modules and the workspace packages
# each app actually imports, which is why the runtime image does not need pnpm at all. Static assets and
# `public/` are excluded from that trace by design and have to be copied alongside it.
RUN set -eu; \
    mkdir -p /out/bin; \
    found=0; \
    for app in apps/*/; do \
      [ -d "$app" ] || continue; \
      name=$(basename "$app"); \
      if [ -d "$app/.next/standalone" ]; then \
        cp -R "$app/.next/standalone/." /out/; \
        mkdir -p "/out/$app/.next"; \
        [ -d "$app/.next/static" ] && cp -R "$app/.next/static" "/out/$app/.next/static"; \
        [ -d "$app/public" ] && cp -R "$app/public" "/out/$app/public"; \
        found=$((found + 1)); \
        echo "collected $name"; \
      else \
        echo "WARNING: $name produced no .next/standalone — is output: 'standalone' set in its next.config?"; \
      fi; \
    done; \
    cp infra/docker/start.mjs /out/bin/start.mjs; \
    echo "$found application(s) in the image"

########################################################################################################
# runtime — what the service runs
########################################################################################################
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl \
    && addgroup --system --gid 1001 oneresi \
    && adduser --system --uid 1001 --ingroup oneresi oneresi

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV APP_PORT=3001
ENV HOSTNAME=0.0.0.0

# Owned by the unprivileged user in the copy itself, so Next can write its ISR cache without a
# recursive chown duplicating the whole tree in another layer.
COPY --from=build --chown=oneresi:oneresi /out ./
COPY --chmod=0755 infra/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Everything from here runs unprivileged.
USER oneresi

EXPOSE 3000

# ECS has its own health check in the task definition, which is the one the circuit breaker reads. This
# one is for `docker run` locally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/bin/start.mjs"]

########################################################################################################
# migrate — the one-off ECS task. Same source, same install, but the workspace and its dev
# dependencies are kept, because `prisma migrate deploy` needs the Prisma CLI and the seed is
# TypeScript. Pulled once per apply and then gone; the service never runs this image.
########################################################################################################
FROM build AS migrate

ENV NODE_ENV=production

COPY --chmod=0755 infra/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY infra/docker/migrate.mjs /build/bin/migrate.mjs

# Runs unprivileged too. `node` already exists in the base image. Only three paths need to be writable
# — pnpm's home, the transpile cache and the entrypoint — so there is no recursive chown of the
# workspace, which would double the size of the image.
RUN mkdir -p /build/node_modules/.cache \
    && chown -R node:node /pnpm /build/node_modules/.cache /build/bin

ENV XDG_CACHE_HOME=/build/node_modules/.cache
ENV TMPDIR=/tmp

USER node

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/build/bin/migrate.mjs"]
