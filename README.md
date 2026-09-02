# LeRobot Studio &nbsp;·&nbsp; [Live Demo →](https://lerobot.studio)

[简体中文 — README.zh-CN.md](README.zh-CN.md)

[![CI](https://github.com/ioai-tech/lerobot-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/ioai-tech/lerobot-studio/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@ioai/lerobot-studio.svg)](https://www.npmjs.com/package/@ioai/lerobot-studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-VitePress-blue.svg)](https://ioai-tech.github.io/lerobot-studio/)

> Open [LeRobot](https://github.com/huggingface/lerobot) datasets in your browser. View video, charts, and raw data together, or add the same viewer to a React application.

Use it as a standalone site at [lerobot.studio](https://lerobot.studio), or install the [`@ioai/lerobot-studio`](https://www.npmjs.com/package/@ioai/lerobot-studio) React package from npm. Local folders and archives are processed in your browser and are not uploaded to a cloud service. If you open a remote URL, the browser requests data from that URL's server.

<p align="center">
  <img src=".github/assets/lerobot-studio-demo.webp" alt="LeRobot Studio demo — synchronized video, charts, and episode navigation" width="800" />
</p>

---

## Documentation

| Document                                   | Description                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| [User Guide](docs/user-manual.md)          | Open data, browse episodes, inspect panels, edit, export, and use shortcuts. |
| [Quick Start](docs/quick-start.md)         | Start with the standalone app or install the React package.                  |
| [Embed in React](docs/embedding.md)        | Install and configure the viewer in your application.                        |
| [API Reference](docs/api.md)               | `LeRobotViewer` props, data sources, and generated types.                    |
| [Data formats](docs/data-formats.md)       | Supported LeRobot versions, subtasks, and official Hub examples.             |
| [CORS & Range](docs/cors.md)               | Headers needed for remote archives.                                          |
| [Browser support](docs/browser.md)         | Chromium / Firefox / WebKit notes.                                           |
| [Troubleshooting](docs/troubleshooting.md) | Common failure modes.                                                        |
| [Development](docs/development.md)         | Local setup and tests.                                                       |
| [Deployment](docs/deployment.md)           | Docker, Cloudflare, sample env.                                              |
| [Contributing](CONTRIBUTING.md)            | How to send a PR.                                                            |
| [Security](SECURITY.md)                    | Reporting vulnerabilities.                                                   |

Full docs site: [ioai-tech.github.io/lerobot-studio](https://ioai-tech.github.io/lerobot-studio/)

---

## Features

- **Open local or remote data** — folders, `.zip`, `.tar`, `.tar.gz`, `.tgz`, and HTTP(S) archives
- **Inspect data together** — synchronized video, images, charts, and raw features
- **Navigate efficiently** — search and filter episodes, control playback, and use keyboard shortcuts
- **Review dataset quality** — inspect dataset statistics and export health-check reports
- **Edit and export in the standalone app** — update episode tasks, remove or restore episodes, and export `v2.1` or `v3.0` datasets
- **View and annotate subtasks (`v3.0`)** — official `subtask_index` ranges, Q/R labels, and export with full coverage (never writes `-1`)
- **Embed in React** — use the read-only viewer in a React 19 application
- **Keep local data local** — local files are processed in the browser; the npm package does not collect usage data

---

## Quick Start (website)

Open **[lerobot.studio](https://lerobot.studio)** — no installation required.

Choose a local folder, a local archive, or paste a remote archive URL. For a guided walkthrough, see the [User Guide](docs/user-manual.md).

### Run this repo locally

```bash
git clone https://github.com/ioai-tech/lerobot-studio.git
cd lerobot-studio
npm ci
npm run fixtures:generate
npm run dev          # http://localhost:5173
npm run build        # production SPA → dist/
```

Docker:

```bash
docker build -t lerobot-studio .
docker run --rm -p 8080:8080 lerobot-studio
```

---

## Embedding in React

The React package is published on npm as [`@ioai/lerobot-studio`](https://www.npmjs.com/package/@ioai/lerobot-studio). Install it with:

```bash
npm install @ioai/lerobot-studio
```

> **Requirements:** `react` and `react-dom` `^19.0.0`, ES modules, and client-side rendering. Server-side rendering, React Server Components, and Node.js are not supported.

### Stylesheet

```tsx
import '@ioai/lerobot-studio/style.css';
```

### Basic usage

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function App() {
  return (
    <div style={{ height: 720, minHeight: 480 }}>
      <LeRobotViewer dataSource="https://example.com/dataset.zip" />
    </div>
  );
}
```

Give the wrapper an explicit height. The viewer fills its parent and does not set the page height.

### Next.js (client only)

```tsx
'use client';

import dynamic from 'next/dynamic';

const Viewer = dynamic(() => import('@ioai/lerobot-studio').then((m) => m.LeRobotViewer), {
  ssr: false,
});
```

More integration examples: [Embedding Guide](docs/embedding.md) · [API Reference](docs/api.md).

---

## Supported datasets

| `codebase_version`                               | Open                   | Notes                                       |
| ------------------------------------------------ | ---------------------- | ------------------------------------------- |
| `v2.1`                                           | View, edit, and export | Fully supported                             |
| `v3.0`                                           | View, edit, and export | Fully supported                             |
| Newer `v2` or `v3` minor version                 | View only              | Editing and export are disabled             |
| `v2.0`, other major versions, or missing version | Not opened             | The app does not guess a compatible version |

Archives: `.zip`, `.tar`, `.tar.gz`, `.tgz`.

The npm package is for viewing and in-session episode changes. The export engine is only available in the standalone app. Details: [Data formats](docs/data-formats.md).

---

## Contributing

Issues and PRs welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

- Bugs / features → GitHub Issues
- Security → [SECURITY.md](SECURITY.md)

---

## License

[MIT](LICENSE) © 2026 [IO-AI.TECH](https://io-ai.tech)

Third-party notices: [NOTICE](NOTICE). LeRobot Studio is an independent project and is not affiliated with Hugging Face.
