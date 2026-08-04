# Contributing to LeRobot Studio

## Development setup

Requirements: Node.js 24 and npm 11.7.0.

```bash
npm ci
npm run fixtures:generate
npm run dev
```

Before a pull request, run `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm run test:unit`, and the relevant build target. Run
browser, compatibility, and npm-consumer checks when the change affects those
surfaces.

## Architecture guidelines

The repository has one publishable package. Keep the dependency direction
`web → react → platform → core`; UI is shared by React and the app. `core`
remains free of React and browser APIs, while WASM, workers, and file-system
integration stay in `src/platform`. The public npm API is
`src/react/index.ts`.

The stable 1.0 library is viewer-only, ESM/CSR-only, browser-only, and targets
React `^19.0.0`. Do not add editing or export services to the stable public API,
SSR/RSC paths, CommonJS output, telemetry, or undocumented network calls.

## Compatibility and data integrity

Read [Compatibility](./docs/compatibility.md) before changing loaders,
validators, media handling, export, packaging, or browser APIs.

- Treat dataset input as untrusted and preserve source data.
- Support LeRobot `v2.1` and `v3.0` by exact declared version only.
- Keep unknown versions warning-marked and read-only; export must be blocked in
  both UI and service layers.
- Do not call export supported until official LeRobot training-readiness tests
  pass for the complete output.
- Add fixtures and regression tests for behavior changes. Record actual browser
  versions for browser compatibility claims.

## Pull requests

Keep changes focused and explain user-visible behavior, compatibility impact,
test evidence, privacy/security impact, and migration steps. Public API changes
must follow the [deprecation policy](./docs/deprecation.md). A maintainer and
required CODEOWNERS approve changes; authors do not approve their own pull
requests.

By contributing, you agree that your contribution is licensed under the
repository’s [MIT License](./LICENSE).

## Code of conduct

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities via [SECURITY.md](./SECURITY.md).

For usage questions and support boundaries, see [SUPPORT.md](./SUPPORT.md).
