# syntax=docker/dockerfile:1

# Build the publishable tarball from the repository (named context `lerobot` = repo root).
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS pack-builder
WORKDIR /repo
COPY --from=lerobot package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts
COPY --from=lerobot . .
RUN npm run build:lib
RUN mkdir -p /pack && npm pack --pack-destination /pack

# Install the tarball in an isolated Vite + React 19 consumer and build for static hosting.
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS vite-consumer
WORKDIR /app
COPY vite-react/package.json ./
COPY --from=pack-builder /pack/*.tgz ./lerobot-studio.tgz
RUN --mount=type=cache,target=/root/.npm \
    npm install --ignore-scripts --no-audit --no-fund && \
    npm install --ignore-scripts --no-audit --no-fund react@19.2.8 react-dom@19.2.8
COPY vite-react/ ./
RUN npm run typecheck && npm run build

# Install the tarball in an isolated Next.js App Router client-only consumer.
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS next-consumer
WORKDIR /app
COPY next-app-router/package.json ./
COPY --from=pack-builder /pack/*.tgz ./lerobot-studio.tgz
RUN --mount=type=cache,target=/root/.npm \
    npm install --ignore-scripts --no-audit --no-fund && \
    npm install --ignore-scripts --no-audit --no-fund react@19.2.8 react-dom@19.2.8
COPY next-app-router/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run typecheck && npm run build

# Prove the Vite bundle is servable from a non-root mount path and Next produced output.
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS test
WORKDIR /verify
COPY --from=vite-consumer /app/dist /vite-dist
COPY --from=next-consumer /app/.next /next-dist
COPY scripts/verify-static-serve.mjs ./
RUN node verify-static-serve.mjs /vite-dist /next-dist
