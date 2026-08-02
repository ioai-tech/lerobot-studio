# LeRobot Studio

Browser-based visualizer for [LeRobot](https://github.com/huggingface/lerobot) datasets, by [IO-AI.TECH](https://io-ai.tech).

Live demo: [https://lerobot.studio](https://lerobot.studio)

- Open local folders, local archives, or remote archives (CORS + Range required)
- Synced video / charts / raw feature inspection
- Export and light editing workflows
- Embeddable React package: `@ioai/lerobot-studio`

## Open source

LeRobot Studio is developed in the open at
[ioai-tech/lerobot-studio](https://github.com/ioai-tech/lerobot-studio).

- Report reproducible bugs or propose improvements through
  [GitHub Issues](https://github.com/ioai-tech/lerobot-studio/issues).
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
npm run build:web
npm run preview
```

Docker:

```bash
docker build -t lerobot-studio .
docker run --rm -p 8080:80 lerobot-studio
```

## Repository layout

```
apps/web                 Standalone web application
packages/core            Domain logic (no React)
packages/platform        Browser/WASM adapters
packages/react           Published React library
packages/ui              Shared UI primitives
tests/                   Unit + browser tests
docs/                    Architecture and ops docs
```

## Library usage

```bash
npm install @ioai/lerobot-studio
```

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function App() {
  return <LeRobotViewer dataSource="https://example.com/dataset.zip" />;
}
```

## Documentation

- [Architecture](./docs/architecture.md)
- [Development](./docs/development.md)
- [Deployment](./docs/deployment.md)
- [GitHub migration checklist](./docs/github-migration.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Third-party notices](./NOTICE)

## Deploy

The public site at [https://lerobot.studio](https://lerobot.studio) is deployed by
Cloudflare Workers Builds connected to this GitHub repository (`main` branch).
See [Deployment](./docs/deployment.md).

## Privacy

The open-source distribution does not ship third-party analytics (no Google Analytics / Clarity).

## License

[MIT](./LICENSE) — Copyright (c) 2026 IO-AI.TECH
