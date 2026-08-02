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
RUN npm ci
COPY . .
RUN npm run build

FROM busybox:1.37 AS runtime
COPY --from=build /app/dist /dist
COPY docker/httpd.conf /etc/httpd.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["busybox", "httpd", "-f", "-p", "80", "-h", "/dist", "-c", "/etc/httpd.conf"]
