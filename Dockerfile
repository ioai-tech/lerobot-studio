# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app

ARG SITE_URL
ENV SITE_URL=${SITE_URL}

ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}

ARG VITE_SAMPLES_BASE_URL
ENV VITE_SAMPLES_BASE_URL=${VITE_SAMPLES_BASE_URL}

ENV VITE_BASE=${BASE_PATH}

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/platform/package.json ./packages/platform/
COPY packages/ui/package.json ./packages/ui/
COPY packages/react/package.json ./packages/react/
RUN npm ci
RUN node -e "\
  const { execSync } = require('child_process'); \
  const v = require('rolldown/package.json').version; \
  const binding = process.arch === 'x64' \
    ? '@rolldown/binding-linux-x64-gnu' \
    : '@rolldown/binding-linux-arm64-gnu'; \
  try { require(binding); } \
  catch { execSync('npm install ' + binding + '@' + v + ' --no-save', { stdio: 'inherit' }); } \
"

COPY . .
RUN npm run build:web && \
  BASE_PATH="${BASE_PATH:-/}" && \
  case "$BASE_PATH" in \
    */) ;; \
    *) BASE_PATH="${BASE_PATH}/" ;; \
  esac && \
  case "$BASE_PATH" in \
    /*) ;; \
    *) BASE_PATH="/${BASE_PATH}" ;; \
  esac && \
  BASE_PATH_TRIM="${BASE_PATH%/}" && \
  if [ -z "$BASE_PATH_TRIM" ]; then BASE_PATH_TRIM="/"; fi && \
  OUT_DIR="/app/out" && \
  if [ "$BASE_PATH_TRIM" != "/" ]; then OUT_DIR="/app/out${BASE_PATH_TRIM}"; fi && \
  mkdir -p "$OUT_DIR" && \
  cp -R /app/apps/web/dist/* "$OUT_DIR/"


FROM busybox:1.37 AS runtime

ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}

COPY --from=build /app/out /dist
COPY docker/httpd.conf /etc/httpd.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1${BASE_PATH:-/}" >/dev/null 2>&1 || exit 1

CMD ["busybox", "httpd", "-f", "-p", "80", "-h", "/dist", "-c", "/etc/httpd.conf"]
