# syntax=docker/dockerfile:1

# Multi-stage build producing a small Next.js standalone runtime image.
# Requires `output: "standalone"` in next.config.ts.

FROM node:22-alpine AS base
# libc6-compat helps some native deps (e.g. sharp) run on Alpine.
RUN apk add --no-cache libc6-compat

# --- Install dependencies (cached on lockfile) ---
FROM base AS deps
WORKDIR /app
# .npmrc travels with the lockfile and is not optional. It carries
# legacy-peer-deps, without which `npm ci` fails outright on better-auth's
# optional @sveltejs/kit peer (see the file for why). Leave it out and this
# stage dies before compiling anything, with an error about a framework the
# project does not use.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# --- Build the app ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build in mongodb mode so rendering semantics match production: the root
# layout reads the session (headers()) only in mongodb mode, and building in
# memory mode statically prerenders routes that are dynamic at runtime — those
# then 500 with DYNAMIC_SERVER_USAGE.
# MONGODB_URI/BETTER_AUTH_SECRET are inert build-time placeholders: Next's
# page-data collection instantiates the Better Auth route module (which
# requires them to exist) but never opens a connection. Runtime values come
# from the deployment env file.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATA_SOURCE=mongodb \
    MONGODB_URI=mongodb://build-placeholder:27017/build \
    BETTER_AUTH_SECRET=build-placeholder-secret-never-used-at-runtime
RUN npm run build

# --- Runtime image ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone output bundles only the files needed to run.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
