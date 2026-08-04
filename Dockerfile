# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS build
WORKDIR /app

ARG SITE_URL
ENV SITE_URL=${SITE_URL}
ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}
ARG VITE_SAMPLES_BASE_URL
ENV VITE_SAMPLES_BASE_URL=${VITE_SAMPLES_BASE_URL}
ENV VITE_BASE=${BASE_PATH}

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM busybox:1.37@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0 AS runtime
COPY --from=build /app/dist /dist
# SPA index + MIME types for static assets (formerly docker/httpd.conf)
RUN printf '%s\n' \
  'I:index.html' \
  '.wasm:application/wasm' \
  '.js:application/javascript' \
  '.mjs:application/javascript' \
  '.json:application/json' \
  '.map:application/json' \
  '.svg:image/svg+xml' \
  > /etc/httpd.conf
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
CMD ["busybox", "httpd", "-f", "-p", "8080", "-h", "/dist", "-c", "/etc/httpd.conf"]
