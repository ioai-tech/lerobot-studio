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

### Refresh expiring URLs

Signed URLs expire. Pass `refresh` and the viewer re-signs instead of failing:

```tsx
const dataSource = createRemoteManifestDataSource(files, {
  // Return the same logical paths with new URLs, and when they expire.
  refresh: async () => {
    const signed = await fetchSignedManifest(datasetId);
    return { files: signed.files, expiresAt: signed.expiresAt };
  },
  // Expiry (ISO 8601) of the initial `files` that have no `expiresAt` of their own.
  expiresAt: manifestExpiresAt,
});
```

- A 401 or 403, or a URL within 60 s of its expiry, triggers one `refresh` call. Concurrent failures share it, and a read whose URL predates a finished refresh just retries with the new URL.
- A refresh replaces the expiry. Each refreshed entry expires at its own `expiresAt`, else at the `expiresAt` returned with the files, else at an unknown time; then only a 401 or 403 triggers the next refresh. `refresh` may also return just the entry array.
- Refreshes caused by a near expiry happen at most once per 30 s. A background refresh that fails, or returns URLs that still expire within 60 s, waits longer each time (5 s, doubling up to 5 min).
- The new URLs replace the old ones by path, and the failed read is retried once. Playing videos switch to the new URL at the same time and keep playing or stay paused.
- If the retry fails too, the read fails with a `RemoteSourceError` (`code`: `HTTP_STATUS`, `NETWORK` or `REFRESH_FAILED`, plus `path` and `status`).
- Without `refresh`, a failed read is not retried.

### Show only some episodes

`episodeScope` limits a dataset to a list of `episode_index` values. It works for v2.1 and v3.0:

```tsx
createRemoteManifestDataSource(files, { episodeScope: [3, 4, 9] });
```

Only those episodes are listed and read, so the manifest only needs their files. The health report marks the other episodes as **not evaluated** (`EPISODES_OUT_OF_SCOPE`); they are not reported as missing.

## Show episodes from many recordings

`createEpisodeSetDataSource` shows episodes from many one-episode LeRobot v3 recordings as one dataset. Each episode is a row range of one recording. The viewer signs nothing up front:

```tsx
import { createEpisodeSetDataSource, LeRobotViewer } from '@ioai/lerobot-studio';

const dataSource = createEpisodeSetDataSource(
  {
    fps: 30,
    features, // the recordings' shared info.json features
    recordings: recordingIds.map((id) => ({ id })),
    episodes: [
      {
        recordingId: 'r7',
        task: 'pick cube',
        fromRow: 300,
        toRow: 600,
        fromS: 10,
        toS: 20,
        meta: { split: 'train' },
      },
      // ...
    ],
  },
  {
    // Sign the files of up to 50 recordings: [{ id, files: RemoteFileEntry[] }].
    resolve: (ids) => signRecordings(ids),
  },
);

<LeRobotViewer dataSource={dataSource} />;
```

- Opening the set calls nothing. The first read of a recording resolves it, together with the recordings of the two episodes after the one being opened. If that call fails, the selected recording is resolved on its own, so a failing prefetch never blocks the episode being opened.
- URL refresh re-signs only recordings already resolved (`refresh`, default `resolve`).
- Every recording must be one episode: one data parquet and one MP4 per camera. Other layouts fail with an `EpisodeSetError` (`RECORDING_LAYOUT_REFUSED`). A failed `resolve` gives `RECORDING_RESOLVE_FAILED` for that recording; other episodes still play.
- Rows do not need to start at 0. `meta` values become extra episode columns.
- `previewVideoPath` (for example `'videos/{video_key}/preview.mp4'`) plays a lighter copy of each camera when the recording has one.

## Plot extra time series

`auxiliarySeries` adds time series from separate parquet files, such as a 200 Hz IMU or another process's outputs. They are drawn as extra chart groups on the same playhead:

```tsx
<LeRobotViewer
  dataSource={dataSource}
  auxiliarySeries={[
    {
      id: 'imu',
      label: 'Head IMU',
      files: [{ logicalPath: 'imu.parquet', presignedUrl: imuUrl }],
      timeColumn: 'timestamp_ns',
      timeUnit: 'ns', // 's', 'ns', or 'frame'
      timeOffsetNs: '-1763000000123456789', // optional; makes absolute times episode-relative
      columns: ['gyro_x', 'gyro_y', 'gyro_z'], // optional; default all numeric columns
      episodeIndex: 0, // optional; default every episode
    },
  ]}
  onAuxiliarySeriesWarning={(warning) => console.warn(warning.code, warning.message)}
/>
```

- Samples keep their own rate; they are not resampled to the video frame rate. Charts draw every sample with min/max-per-pixel decimation, and the raw panel shows the sample nearest the playhead.
- Time is converted to seconds from the episode start. `timeOffsetNs` is added for every unit; with `ns` it is exact (it is a string, so int64 timestamps keep full precision). `frame` divides by the dataset fps.
- A parquet timestamp column (for example pandas `datetime64[ns]`) is read exactly as nanoseconds and needs `timeUnit: 'ns'`; any other unit gives `TIME_UNIT_MISMATCH`.
- A missing column gives a warning (`COLUMN_MISSING`, or `TIME_COLUMN_MISSING`, `TIME_UNIT_MISMATCH`, `READ_FAILED`), reported once. The other series still draw. A column missing from only some files is left empty for those files' samples.
- Passing the same series with new URLs (same `logicalPath`s) only swaps URLs; loaded data is not read again.
- Auxiliary series work in single-dataset views only. On an episode set they are ignored with `EPISODE_SET_UNSUPPORTED`.

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

| Prop                       | Use                                                                              |
| -------------------------- | -------------------------------------------------------------------------------- |
| `dataSource`               | Remote archive URL, remote file manifest, or a custom `DataSource`               |
| `theme`                    | `light`, `dark`, or `system`                                                     |
| `language`                 | `en`, `zh`, or `ja`                                                              |
| `showSidebar`              | Show or hide the episode sidebar                                                 |
| `showPlaybackBar`          | Show or hide playback controls                                                   |
| `enableKeyboardShortcuts`  | Enable or disable viewer shortcuts                                               |
| `onFatalError`             | Receive a loading error and render your own error state                          |
| `onExport`                 | Respond when a user clicks your export button                                    |
| `auxiliarySeries`          | Extra time series to plot; see [Plot extra time series](#plot-extra-time-series) |
| `onAuxiliarySeriesWarning` | Receive auxiliary-series warnings                                                |
| `annotation`               | Host-controlled segments: `value`, `onChange`, `saveState`                       |
| `readOnly`                 | Show segments and review without any edit control                                |
| `fields`                   | Values a person sets on each segment (`select`, `tags`, `text`)                  |
| `messages`                 | Replace built-in segment copy by key                                             |

`onExport` is a callback only. It does not include the standalone app's export engine.

When you provide `onFatalError`, the viewer does not render its built-in fatal-error state. Keep the error in your application state and display an appropriate message yourself.

For segments, review and change ops, see [API — Segments and review](./api.md#segments-and-review). For custom `DataSource` implementations and the full type list, see [API reference](./api.md).

## Integration notes

- Give the viewer's parent an explicit height.
- The viewer's root is a labelled `region` landmark (never `main`), so it can sit inside your page's own `main`.
- Each camera's declared codec (`info.features[key].info["video.codec"]`) is checked before loading. If the browser cannot decode it, the camera shows a notice naming the codec instead of a broken player.
- For a remote archive, check CORS and HTTP Range headers.
- In Next.js, keep the viewer in a Client Component with `ssr: false`.
- For editing or built-in export, use the standalone application. Welcome-page helpers only help you pick data and build a local `DataSource`.
