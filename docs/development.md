# Development

> **Language / 语言：** [English](./development.md) | [简体中文](/zh-CN/development)

## Setup

```bash
npm ci
npm run fixtures:generate
npm run dev
```

Node 24 is required (`.nvmrc`). This repository is a single npm package with two build targets.

## Commands

| Command                     | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `npm run dev`               | Start the SPA                                   |
| `npm run build`             | Build the SPA to `dist/`                        |
| `npm run build:lib`         | Build the published library to `dist-lib/`      |
| `npm run docs:dev`          | Start the VitePress documentation site          |
| `npm run docs:build`        | Build documentation and check links             |
| `npm run check:docs-i18n`   | Verify Markdown `.zh-CN.md` pairs or exceptions |
| `npm run check:bundle-size` | Enforce npm and Web bundle size budgets         |
| `npm run typecheck`         | Type-check application and library sources      |
| `npm run test:unit`         | Run Node-based Vitest tests                     |
| `npm run test:browser`      | Run Playwright browser tests                    |
| `npm run fixtures:generate` | Recreate synthetic LeRobot fixtures             |

## Official local datasets

Local Node and browser tests skip when these folders are missing. Download with the Hugging Face CLI, then start `npm run dev` (or `npm run test:browser`):

```bash
hf download lerobot/libero_10_subtask --type=dataset --local-dir /data/lerobot/libero_10_subtask
hf download lerobot/pusht-subtask --type=dataset --local-dir /data/lerobot/pusht-subtask
hf download k1000dai/libero-subtaskid-segments --type=dataset --local-dir /data/lerobot/libero-subtaskid-segments
hf download lerobot/outdoor-depth --type=dataset --local-dir /data/lerobot/outdoor-depth
```

| Path                                      | Used as                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `/data/lerobot/libero_10_subtask`         | Official `v3.0` `subtask_index` standard (`LEROBOT_V3_SUBTASK_DATASET`)                |
| `/data/lerobot/pusht-subtask`             | Official labeled `v3.0` with `meta/subtasks.parquet` (`LEROBOT_PUSHT_SUBTASK_DATASET`) |
| `/data/lerobot/libero-subtaskid-segments` | Community `subtask_id` snapshot; not mapped as official subtasks                       |
| `/data/lerobot/outdoor-depth`             | Official depth-only `v3.0` (`LEROBOT_DEPTH_DATASET`); 16-bit TIFF frames               |

`libero_10_subtask` is large (videos). Browser e2e serves a slim first-parquet slice; Node tests also load the official folder directly. `pusht-subtask` is small enough to serve in full.

## Bundle size gate

Build both targets before running the size gate:

```bash
npm run build:lib
npm run build
npm run check:bundle-size
```

The gate measures raw and gzip sizes for the stable library entry, library and
initial Web CSS, Web entry/modulepreload chunks, lazy DataLoader and Dockview
chunks, Worker/WASM artifacts, and the packed npm tarball. It also fails when
required artifacts are missing, an unexpected JavaScript chunk exceeds the
per-chunk ceiling, or the complete npm tarball exceeds its packed or unpacked
budget. Hashed filenames are discovered from build output and `dist/index.html`
rather than being fixed in the script.

The hard limits are round integer ceilings above the current artifacts. The
library Worker chunk is a known large baseline that still needs optimization,
not an ideal target. Passing this gate only means that bundle size has not
materially regressed.

For a local negative test, lower every budget without changing the checked-in
limits:

```bash
BUNDLE_SIZE_BUDGET_SCALE=0.01 npm run check:bundle-size
```

The scale override can only tighten budgets (`0 < scale <= 1`); it cannot relax
the CI gate.

## Package validation

```bash
npm run build:lib
npm run verify:npm-consumer
```

The 1.0 release requires consumer fixtures for Vite and Next.js client-only
usage, React/React DOM `^19.0.0`, ESM import, CSS loading, workers, and WASM.
Server rendering, React Server Components, CommonJS, and Node.js execution are
outside the package contract.

### Docker npm consumer gate

CI also runs an isolated Docker build that packs the library from the repository,
installs only the resulting tarball in fresh React 19 consumers, and verifies
type-checking, Vite production output, Next.js App Router client-only builds,
and static serving from a non-root mount path:

```bash
npm run test:npm-consumer:docker
```

The Dockerfile lives in `tests/npm-consumer/`. Its primary build context
contains the isolated consumer fixtures, while the named BuildKit context
(`lerobot=.`) supplies the repository source used to create the package. The
pack stage runs `npm run build:lib` and then `npm pack`, exactly matching the
normal declaration, Vite, and API Extractor pipeline. Locally, when Docker is
unavailable, the runner validates the Dockerfile structure and falls back to
`npm run verify:npm-consumer`.

The Docker consumers install **only** the packed tarball (never `file:../..` or
`src/`), pin React 19.2.8, type-check public API imports, build with Vite and
Next App Router (client-only/`ssr: false`), and assert the Vite bundle is
servable from a non-root mount path.

## Compatibility work

Use [Compatibility and release gates](./compatibility.md) as the acceptance
source for version and browser work. In particular:

- match dataset versions exactly (`v2.1` and `v3.0`), never by major prefix;
- allow only newer minor `v2` and `v3` versions to use the read-only adapter;
  reject other or missing versions before any export UI or service;
- treat official LeRobot training-readiness checks as required export tests;
  and
- record actual browser versions and results rather than inferring support from
  API detection.

Changes to public behavior must follow the
[deprecation policy](./deprecation.md).

## UI components

UI primitives live in `src/ui` and are managed from the repository root with the shadcn CLI. Keep generated components in `src/ui/components` and use local `@/ui` or relative imports. Do not reintroduce `@radix-ui/*`; prefer Base UI composition via `render`.

## Documentation i18n

Every repository-owned English Markdown file must have a sibling `.zh-CN.md` copy or an explicit entry in `scripts/docs-i18n-exceptions.json`. Ephemeral directories such as `temp/` are listed in `skipScanDirs` and are not scanned. Language switchers use the site locale routes, while links within a page use relative page routes. Run `npm run check:docs-i18n` to verify. See [Documentation i18n exceptions](./i18n-exceptions.md).
