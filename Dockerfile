# Production image for the Next.js app (standalone output). Built for
# linux/amd64 by scripts/deploy.sh and shipped to the server over SSH.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/scene-core ./packages/scene-core
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_MEDIA_BASE_URL
ARG NEXT_PUBLIC_TIANDITU_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_MEDIA_BASE_URL=$NEXT_PUBLIC_MEDIA_BASE_URL \
    NEXT_PUBLIC_TIANDITU_KEY=$NEXT_PUBLIC_TIANDITU_KEY \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
# The lockfile pins the browser installer and Chromium revision together. Only
# the headless shell is needed; its OS libraries are installed in the final image.
COPY --from=deps /app/node_modules/playwright-core /tmp/playwright-core
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Uploads use FFmpeg, sharp and an isolated software-WebGL model renderer.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && node /tmp/playwright-core/cli.js install --with-deps --only-shell chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /tmp/playwright-core /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --chown=node:node scripts/standalone-http.cjs ./
USER node
EXPOSE 3000
CMD ["node", "--require", "./standalone-http.cjs", "server.js"]
