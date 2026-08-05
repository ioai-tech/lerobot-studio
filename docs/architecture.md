# Architecture

> **Language / 语言：** [English](./architecture.md) | [简体中文](/zh-CN/architecture)

The project contains one npm package and one standalone SPA. The source folders are layers, not separately published packages.

```
src/core       Pure TypeScript domain logic
src/platform   Browser, WASM, workers, File System Access
src/ui         Shared UI primitives / theme
src/react      Public React library entry
src/web        SPA shell (not published on npm)
```

---

## Dependency direction

```
src/web → src/react → src/platform → src/core
                 ↘ src/ui ↗
```

- `core` contains domain logic without React or browser UI dependencies.
- `platform` contains browser, WASM, worker, and file-system integration without React UI.
- `react` is the public API and can use `platform`, `core`, and `ui`.
- `web` is the standalone application and is not exported from the npm package.

---

## Builds

- `npm run build` → `dist/` (static site / Workers assets)
- `npm run build:lib` → `dist-lib/` for `@ioai/lerobot-studio` (CSS scoped under `.lerobot-root`)

Public entry: `src/react/index.ts` + `@ioai/lerobot-studio/style.css`.

The npm package targets ESM browser applications with React `^19.0.0`. It supports viewing and session-only episode changes; the standalone application provides the export engine. SemVer notes: [deprecation](./deprecation.md).

---

## Trust boundaries

- Dataset bytes and paths are treated as untrusted. Failed loads do not rewrite the source.
- Only newer minor releases in the `v2` and `v3` families use a read-only adapter. Other versions are rejected.
- Remote URLs cross the network. CORS, byte-range support, and authentication are configured by the host.
- Browser storage is optional — [Privacy](./privacy.md).
- The npm package does not include telemetry.

See [Compatibility](./compatibility.md).
