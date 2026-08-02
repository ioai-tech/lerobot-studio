# Architecture

LeRobot Studio is a single npm package and SPA repository. The directory boundaries are architectural, not separately published packages.

```
src/core       Pure TypeScript domain logic
src/platform   Browser, WASM, workers and File System Access adapters
src/ui         shadcn Base UI primitives and theme tokens
src/react      Public embeddable React library API
src/web        SPA shell, URL state and deployment-only composition
```

## Dependency rules

```
src/web → src/react → src/platform → src/core
                 ↘ src/ui ↗
```

- `core` must not import React, DOM, browser APIs, or upper layers.
- `platform` must not import React UI.
- `react` exposes the library API and may consume platform, core, and UI modules.
- `web` is not exported from npm; it is the standalone app composition root.

## Build targets

- `npm run build` creates `dist/` for Cloudflare Workers static assets.
- `npm run build:lib` creates `dist-lib/` for `@ioai/lerobot-studio` consumers. The library build scopes CSS under `.lerobot-root` to prevent host-page leakage.

## Public API

The publishable surface is `src/react/index.ts`. Styles are exposed as `@ioai/lerobot-studio/style.css`.
