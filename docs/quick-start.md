# Quick Start

> **Language / 语言：** [English](./quick-start.md) | [简体中文](./quick-start.zh-CN.md)

LeRobot Studio has two entry points:

- the hosted application at [lerobot.studio](https://lerobot.studio); and
- the browser-only React package, after `@ioai/lerobot-studio` is published.

## Use the hosted viewer

Open the live application and choose a local folder, local archive, or remote
archive. Local content is processed in the browser. Remote archives must meet
the documented [CORS and HTTP Range requirements](./cors.md).

## Embed the React viewer

::: warning Publication status
`@ioai/lerobot-studio@1.0.0` is not published yet. Installation and the stable
contract below become available only after the [1.0 release gates](./compatibility.md#_1-0-acceptance-gates)
pass.
:::

```bash
npm install @ioai/lerobot-studio
```

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function DatasetViewer() {
  return (
    <div style={{ height: 720, minHeight: 480 }}>
      <LeRobotViewer dataSource="https://example.com/dataset.zip" />
    </div>
  );
}
```

The host must give the viewer an explicit height. The component fills its
container and does not choose a page height.

## Runtime contract

- React and React DOM `^19.0.0`
- ESM only
- browser and client-side rendering only
- no Node.js, CommonJS, React Server Components, SSR, or hydration support

In Next.js, load the viewer from a Client Component with SSR disabled:

```tsx
'use client';

import dynamic from 'next/dynamic';

const Viewer = dynamic(
  () => import('@ioai/lerobot-studio').then((module) => module.LeRobotViewer),
  { ssr: false },
);
```

See the [stable API](./api.md) for custom data sources, callbacks, and errors.

## Develop this repository

```bash
npm ci
npm run fixtures:generate
npm run dev
```

To work on this documentation site:

```bash
npm run docs:dev
```
