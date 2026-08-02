# Contributing to LeRobot Studio

## Development setup

Requirements: Node.js 24 and npm 11.7.0.

```bash
npm ci
npm run fixtures:generate
npm run dev
```

Before a pull request, run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, and the relevant build target.

## Architecture guidelines

The repository has one publishable package. Keep the dependency direction `web → react → platform → core`; UI is shared by React and the app. `core` remains free of React and browser APIs, while WASM, workers, and file-system integration stay in `src/platform`. The public npm API is `src/react/index.ts`.

## Code of conduct

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities via [SECURITY.md](./SECURITY.md).
