# Development

## Setup

```bash
npm ci
npm run fixtures:generate
npm run dev
```

Node 24 is required (`.nvmrc`). This repository is a single npm package with two build targets.

## Commands

| Command                     | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `npm run dev`               | Start the SPA                              |
| `npm run build`             | Build the SPA to `dist/`                   |
| `npm run build:lib`         | Build the published library to `dist-lib/` |
| `npm run typecheck`         | Type-check application and library sources |
| `npm run test:unit`         | Run Node-based Vitest tests                |
| `npm run test:browser`      | Run Playwright browser tests               |
| `npm run fixtures:generate` | Recreate synthetic LeRobot fixtures        |

## Package validation

```bash
npm run build:lib
npm run verify:npm-consumer
```

## UI components

UI primitives live in `src/ui` and are managed from the repository root with the shadcn CLI. Keep generated components in `src/ui/components` and use local `@/ui` or relative imports. Do not reintroduce `@radix-ui/*`; prefer Base UI composition via `render`.
