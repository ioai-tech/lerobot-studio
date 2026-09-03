# Embed LeRobot Studio in React

> **Language / 语言：** [English](./embedding.md) | [简体中文](/zh-CN/embedding)

Use `@ioai/lerobot-studio` when you want to show a LeRobot dataset inside your own React application. The package provides the viewer. Your application remains responsible for authentication, remote URLs, and export actions.

## Requirements

- React and React DOM `^19.0.0`
- A browser build that supports ES modules and Web Workers
- Client-side rendering only; SSR, React Server Components, CommonJS, and Node.js are not supported

## Install

Install the published package:

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

This helper does not open a file picker. Choose the file in your app, then pass it in. For a folder or archive picker on a custom welcome page, see [Custom welcome page](#custom-welcome-page).

## Show a remote file manifest

Use this when the host already signed individual dataset files and must not download a full archive. `getObjectUrl` returns the remote URL so the browser can stream media with Range requests.

```tsx
import {
  createRemoteManifestDataSource,
  LeRobotViewer,
  type RemoteFileEntry,
} from '@ioai/lerobot-studio';

export function SignedManifestViewer({ files }: { files: RemoteFileEntry[] }) {
  const dataSource = createRemoteManifestDataSource(files);

  return (
    <div style={{ height: 720 }}>
      <LeRobotViewer dataSource={dataSource} theme="system" />
    </div>
  );
}
```

Each entry needs a logical dataset path and an HTTP(S) URL. Optional `contentType` and `sizeBytes` help the viewer and the built-in safety limits.

## Custom welcome page

Most embeds show a landing screen first, then the viewer. Wrap the page in `LeRobotStudioProvider` so that screen and the viewer share theme, language, and styles. Render `LeRobotViewerContent` once you have a `DataSource`:

```tsx
import { useState } from 'react';
import {
  DatasetSourceSelector,
  LeRobotStudioProvider,
  LeRobotViewerContent,
  createArchiveDataSourceFromFile,
  createDirectoryDataSource,
  useDragAndDrop,
  type DataSource,
} from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function CustomWelcome({ language }: { language: string }) {
  const [dataSource, setDataSource] = useState<DataSource | string | null>(null);
  useDragAndDrop({
    onFile: (file) => setDataSource(createArchiveDataSourceFromFile(file)),
    onDirectoryHandle: (handle) => setDataSource(createDirectoryDataSource(handle)),
  });

  return (
    <LeRobotStudioProvider theme="system" language={language}>
      {dataSource ? (
        <div style={{ height: 720 }}>
          <LeRobotViewerContent dataSource={dataSource} showSidebar showPlaybackBar />
        </div>
      ) : (
        <DatasetSourceSelector
          onOpenDirectory={async () => {
            const handle = await window.showDirectoryPicker();
            setDataSource(createDirectoryDataSource(handle));
          }}
          onOpenLocalArchive={() => {
            /* your file input → createArchiveDataSourceFromFile */
          }}
          onOpenRemoteArchive={(url) => url && setDataSource(url)}
        />
      )}
    </LeRobotStudioProvider>
  );
}
```

If you show an export button, wire `onExport` yourself. This package does not include the standalone app's export dialog.

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

| Prop                      | Use                                                                |
| ------------------------- | ------------------------------------------------------------------ |
| `dataSource`              | Remote archive URL, remote file manifest, or a custom `DataSource` |
| `theme`                   | `light`, `dark`, or `system`                                       |
| `language`                | `en`, `zh`, or `ja`                                                |
| `showSidebar`             | Show or hide the episode sidebar                                   |
| `showPlaybackBar`         | Show or hide playback controls                                     |
| `enableKeyboardShortcuts` | Enable or disable viewer shortcuts                                 |
| `onFatalError`            | Receive a loading error and render your own error state            |
| `onExport`                | Respond when a user clicks your export button                      |

`onExport` is a callback only. It does not include the standalone app's export engine.

When you provide `onFatalError`, the viewer does not render its built-in fatal-error state. Keep the error in your application state and display an appropriate message yourself.

For custom `DataSource` implementations and the full type list, see [API reference](./api.md).

## Integration notes

- Give the viewer's parent an explicit height.
- For a remote archive, check CORS and HTTP Range headers.
- In Next.js, keep the viewer in a Client Component with `ssr: false`.
- For editing or built-in export, use the standalone application. Welcome-page helpers only help you pick data and build a local `DataSource`.
