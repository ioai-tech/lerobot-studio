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

FROM busybox:1.38@sha256:dc2d74b28e4cf8984fa52af1f39bc7c3d9c73760b41a74d629f5d11b1ab28616 AS runtime
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
