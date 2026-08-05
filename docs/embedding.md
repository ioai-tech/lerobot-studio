# Embed LeRobot Studio in React

> **Language / 语言：** [English](./embedding.md) | [简体中文](/zh-CN/embedding)

Use `@ioai/lerobot-studio` when you want to show a LeRobot dataset inside your own React application. The package provides the viewer. Your application remains responsible for authentication, remote URLs, and export actions.

## Requirements

- React and React DOM `^19.0.0`
- A browser build that supports ES modules and Web Workers
- Client-side rendering only; SSR, React Server Components, CommonJS, and Node.js are not supported

## Install

`@ioai/lerobot-studio` has not yet been published to npm. After its first registry release, install it with:

```bash
npm install @ioai/lerobot-studio
```

## Add the stylesheet

Import the stylesheet once from your application entry point:

```tsx
import '@ioai/lerobot-studio/style.css';
```

The viewer's styles are scoped under `.lerobot-root` to reduce interference with the rest of your page.

## Show a remote archive

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function DatasetViewer() {
  return (
    <div style={{ height: 720, minHeight: 480 }}>
      <LeRobotViewer
        dataSource="https://datasets.example.com/pick-place.zip"
        theme="system"
        language="en"
      />
    </div>
  );
}
```

Give the wrapper a real height. The viewer fills its parent; it does not choose a page height.

The archive server must allow browser requests from your application. See [CORS and HTTP Range](./cors.md).

## Use a local archive

Use the public helper with a `File` selected by your own UI:

```tsx
import { createArchiveDataSourceFromFile, LeRobotViewer } from '@ioai/lerobot-studio';

export function LocalDatasetViewer({ file }: { file: File }) {
  const dataSource = createArchiveDataSourceFromFile(file);

  return (
    <div style={{ height: 720 }}>
      <LeRobotViewer dataSource={dataSource} />
    </div>
  );
}
```

The npm viewer does not include a local file or folder picker. Use the standalone application when your application needs that flow.

## Next.js

Load the viewer from a Client Component and disable SSR:

```tsx
'use client';

import dynamic from 'next/dynamic';

const LeRobotViewer = dynamic(
  () => import('@ioai/lerobot-studio').then((module) => module.LeRobotViewer),
  { ssr: false },
);
```

## Customize behavior

Common props include:

| Prop                      | Use                                                     |
| ------------------------- | ------------------------------------------------------- |
| `dataSource`              | Remote archive URL or a custom `DataSource`             |
| `theme`                   | `light`, `dark`, or `system`                            |
| `language`                | `en`, `zh`, or `ja`                                     |
| `showSidebar`             | Show or hide the episode sidebar                        |
| `showPlaybackBar`         | Show or hide playback controls                          |
| `enableKeyboardShortcuts` | Enable or disable viewer shortcuts                      |
| `onFatalError`            | Receive a loading error and render your own error state |
| `onExport`                | Respond when a user clicks your export button           |

`onExport` is a callback only. It does not include the standalone app's export engine.

When you provide `onFatalError`, the viewer does not render its built-in fatal-error state. Keep the error in your application state and display an appropriate message yourself.

For custom `DataSource` implementations and the full type list, see [API reference](./api.md).

## Integration notes

- Give the viewer's parent an explicit height.
- For a remote archive, check CORS and HTTP Range headers.
- In Next.js, keep the viewer in a Client Component with `ssr: false`.
- For editing or built-in export, use the standalone application.
