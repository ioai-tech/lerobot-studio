# Contributing to LeRobot Studio

Thanks for helping improve LeRobot Studio.

## Development setup

Requirements:

- Node.js 24 (see `.nvmrc`)
- npm 11.7.0 (pinned by the root `packageManager` field)

```bash
npm ci
npm run fixtures:generate
npm run dev
```

Useful scripts:

- `npm run test:unit` — unit tests (required for PRs)
- `npm run test:browser` — Playwright browser tests (nightly / release)
- `npm run lint` — ESLint
- `npm run build:web` / `npm run build:lib` — production builds
- `npm run format:check` — verify Prettier formatting without modifying files
- `npm run format` — apply Prettier formatting

## Pull requests

1. Branch from the latest default branch.
2. Keep changes focused and documented.
3. Ensure `npm run format:check`, `npm run lint`, `npm run test:unit`, and the
   relevant builds pass.
4. Add a changeset when changing the published `@ioai/lerobot-studio` package:

```bash
npm run changeset
```

## Architecture guidelines

Dependency direction must remain:

```
apps/web → packages/react → packages/platform → packages/core
                 ↘ packages/ui ↗
```

- `core` must stay free of React and browser-only APIs.
- Browser/WASM/FS Access code belongs in `platform`.
- Public library API lives in `packages/react/src/index.ts`.

## Code of conduct

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities via [SECURITY.md](./SECURITY.md).
