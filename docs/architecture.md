# Architecture

> **Language / 语言：** [English](./architecture.md) | [简体中文](./architecture.zh-CN.md)

LeRobot Studio is a single npm package and client-rendered SPA repository. The
directory boundaries are architectural, not separately published packages.

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

The publishable surface is `src/react/index.ts`. Styles are exposed as
`@ioai/lerobot-studio/style.css`.

The stable 1.0 package contract is viewer-only, ESM-only, browser-only, and
CSR-only with React and React DOM `^19.0.0`. “Viewer-only” means that dataset
viewing is the only stable library workflow; source mutation, editing, export
services, and standalone application controls are not stable public APIs. Any
export that exceeds that boundary must remain internal or be explicitly
classified before 1.0.

Public APIs remain backward compatible within major version 1 according to the
[deprecation policy](./deprecation.md).

## Trust boundaries

- Dataset parsing, validation, media handling, and export operate on untrusted
  input and must fail without modifying source data.
- Unknown dataset versions must not silently select a version adapter. The 1.0
  behavior is warning-marked read-only inspection when safe, with export
  disabled.
- Remote sources cross an external network boundary; CORS, Range,
  authentication, availability, and remote logging are controlled by the host
  and source server.
- Browser storage is optional and failure-tolerant. See [Privacy](./privacy.md).
- The npm library has a zero-telemetry contract.

These trust-boundary guarantees include 1.0 release gates tracked in
[Compatibility](./compatibility.md). Core paths are **automated CI verified**;
the final manual release gate for `1.0.0` is still pending.
