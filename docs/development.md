# Development

## Setup

```bash
npm ci
npm run fixtures:generate
npm run dev
```

Node 24 is required (`.nvmrc`).

## Workspace commands

| Command                     | Purpose                                |
| --------------------------- | -------------------------------------- |
| `npm run dev`               | Start the web app                      |
| `npm run test:unit`         | Vitest node tests                      |
| `npm run test:browser`      | Playwright browser tests               |
| `npm run build:web`         | Build SPA to `apps/web/dist`           |
| `npm run build:lib`         | Build library to `packages/react/dist` |
| `npm run fixtures:generate` | Recreate synthetic LeRobot fixtures    |

## Test fixtures

Unit tests use minimal synthetic datasets in `tests/fixtures/datasets/`.
Generate them with:

```bash
npm run fixtures:generate
```

Do not commit large private datasets. Browser export tests that need real media
run in nightly / release workflows.

## Publishing package locally

```bash
npm run build:lib
npm pack -w @ioai/lerobot-studio
```

## UI components (shadcn Base UI)

UI primitives live only in `packages/ui` and are managed with the official
shadcn CLI (Base UI / `base-nova` preset):

```bash
cd packages/ui
npx shadcn@latest add <component> -y --overwrite
# Rewrite generated `@/` imports to relative paths if needed, then export from src/index.ts
```

Do not reintroduce `@radix-ui/*` packages. Prefer Base UI composition via
`render` instead of Radix `asChild`. After adding components, run
`npm run typecheck -w @ioai/lerobot-studio-web` and `npm run test:browser`.
