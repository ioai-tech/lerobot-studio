# LeRobot Studio

Browser-based viewer for [LeRobot](https://github.com/huggingface/lerobot)
datasets, by [IO-AI.TECH](https://io-ai.tech).

Live demo: [https://lerobot.studio](https://lerobot.studio)

This repository is preparing the stable `1.0.0` contract. Viewing is the only
stable public library workflow: the package does not mutate source datasets and
does not expose an editor API. Export in the standalone application is not part
of the stable library API and remains a **1.0 release gate** until its output is
validated as directly consumable by official LeRobot training.

- Open local folders, local archives, or remote archives
- Inspect synchronized video, charts, and raw features
- Embed the client-only React viewer through `@ioai/lerobot-studio`
- Process dataset content locally in the browser

## Open source

LeRobot Studio is preparing for public development at
`github.com/ioai-tech/lerobot-studio`. That public repository and its issue
tracker are part of the GitHub migration and may not be available yet.

- After publication, report reproducible bugs or propose improvements through
  the repository’s GitHub Issues.
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a pull request.
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md) in all community spaces.
- Report security vulnerabilities only through the private process in
  [SECURITY.md](./SECURITY.md).

## Quick start

```bash
npm ci
npm run fixtures:generate
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Docker:

```bash
docker build -t lerobot-studio .
docker run --rm -p 8080:80 lerobot-studio
```

Then open [http://localhost:8080](http://localhost:8080). For production
hosting, see [Deployment](./docs/deployment.md).

## Repository layout

```
src/core                 Domain logic (no React)
src/platform             Browser/WASM adapters and workers
src/ui                   Shared UI primitives
src/react                Published React library API
src/web                  Standalone web application shell
tests/                   Unit + browser tests
docs/                    Architecture and ops docs
```

## Library usage

After the `1.0.0` package is published:

```bash
npm install @ioai/lerobot-studio
```

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function App() {
  return (
    <div style={{ height: '720px', minHeight: '480px' }}>
      <LeRobotViewer dataSource="https://example.com/dataset.zip" />
    </div>
  );
}
```

The host must give the viewer an explicit height; the component fills its
container and does not choose a page height. The `1.0.0` compatibility contract
is React and React DOM `^19.0.0`, ESM-only, browser-only, and CSR-only. Vite and
Next.js client-only consumer validation remains a 1.0 release gate.

### Vite

Import and render the component normally in client code. Do not externalize its
CSS, workers, or WASM assets from the browser build.

### Next.js

Load the viewer from a Client Component with SSR disabled:

```tsx
'use client';

import dynamic from 'next/dynamic';

const Viewer = dynamic(
  () => import('@ioai/lerobot-studio').then((module) => module.LeRobotViewer),
  { ssr: false },
);
```

LeRobot Studio does not support React Server Components, server rendering,
CommonJS, or execution in Node.js.

## Compatibility contract

- Stable line: `1.0.0`; minor and patch releases remain backward compatible
  within major version 1, subject to the [deprecation policy](./docs/deprecation.md).
- Dataset formats planned for exact 1.0 support: LeRobot `v2.1` and `v3.0`.
  Prefix-compatible variants such as `v2.0`, `v2.x`, or `v3.x` are not covered.
- Unknown versions must open only in warning-marked read-only mode when they can
  be parsed safely, and export must remain disabled. This behavior is a 1.0
  release gate and is not yet guaranteed by the current implementation.
- Export for supported versions may be released only after official LeRobot
  training-readiness validation. No best-effort export is considered supported.
- The npm library ships with zero telemetry. It must not send analytics,
  diagnostics, dataset metadata, filenames, or usage events.

See [Compatibility and release gates](./docs/compatibility.md) for browser,
dataset, network, and capability matrices.

## Documentation

- [Quick Start](./docs/quick-start.md)
- [Stable API](./docs/api.md)
- [Data formats](./docs/data-formats.md)
- [CORS and HTTP Range](./docs/cors.md)
- [Browser support](./docs/browser.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Migration](./docs/migration.md)
- [Architecture](./docs/architecture.md)
- [Compatibility and release gates](./docs/compatibility.md)
- [Development](./docs/development.md)
- [Deployment](./docs/deployment.md)
- [Privacy](./docs/privacy.md)
- [Deprecation policy](./docs/deprecation.md)
- [GitHub migration checklist](./docs/github-migration.md)
- [Contributing](./CONTRIBUTING.md)
- [Governance](./GOVERNANCE.md)
- [Support](./SUPPORT.md)
- [Security](./SECURITY.md)
- [Third-party notices](./NOTICE)

## Deploy

The public site is [https://lerobot.studio](https://lerobot.studio). Connecting
the migrated GitHub `main` branch to Cloudflare Workers Builds is the planned
production path and must be verified during migration. See
[Deployment](./docs/deployment.md).

## Privacy

The npm library has a zero-telemetry contract. The application uses browser
storage for preferences, recent-source metadata, and—when the browser permits
it—local file handles. Dataset bytes are processed locally unless the user
opens a remote URL. See [Privacy](./docs/privacy.md).

## License

[MIT](./LICENSE) — Copyright (c) 2026 IO-AI.TECH
