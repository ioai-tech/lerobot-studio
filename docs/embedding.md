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

### Charts read only what they show

The charts of an episode need its numeric columns, not the whole data file. The viewer reads parquet data files with HTTP Range requests:

- The footer first (the last 64 KB), then only the selected columns' chunks of the row groups that hold the episode, nearby chunks in one request. Switching to another episode of the same file reuses the bytes already read.
- The time axis and the top chart group arrive first, then the other groups: each chart draws as soon as its columns are in, and groups still loading show a placeholder (`aria-busy`). The raw panel's other columns are read after the charts.
- With `sizeBytes` the requests are plain `bytes=a-b` ranges, a CORS-safelisted header (no preflight). Without it the footer request is a suffix range and the size comes from `Content-Range`, which a cross-origin server must expose (`Access-Control-Expose-Headers: Content-Range`).
- A server that ignores `Range` (answers `200`) costs one whole-file download, reused for every column; the viewer logs `RANGE_UNSUPPORTED` once and reads that source's files whole. `RANGE_SIZE_UNKNOWN` (no size) and a file that is not parquet fall back the same way, by name.
- Reads of one file are combined only when they report the same size and, when the server exposes it, the same `ETag` (`Access-Control-Expose-Headers: ETag`). A file that changed is opened again from its new footer once; if it changes again, it is read whole (`FILE_CHANGED`).
- A footer that cannot be trusted (spans outside the data, oversized lists, a footer over 64 MiB) is refused before anything is read with it, and the file is read whole (`FOOTER_INVALID`).
- Each fallback reason is logged once per viewer.

The first chart is drawn soon after the first video frame; the other charts are limited by how fast their bytes arrive on the link, which they share with the cameras.

Row groups are the smallest unit: a writer that puts many episodes in one row group (pyarrow's default for small files) still costs the episode's columns for the whole group.

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
- If the retry fails too, the read fails with a `RemoteSourceError` (`code`: `HTTP_STATUS`, `NETWORK` or `REFRESH_FAILED`, plus `path` and `status`). Range reads keep their range across the refresh.
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

`auxiliarySeries` adds time series from separate parquet files, such as a 200 Hz IMU or another process's outputs. They are drawn as extra chart groups on the same playhead. They are read after the episode's charts, so they never delay them:

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
- `timeColumn: null` with `timeUnit: 'frame'` means the row index is the time: row `i` (counted across `files` in order) is frame `i`. Use it for per-frame outputs that carry no time column; every numeric column is plotted. `null` with another unit is refused with `ROW_TIME_NEEDS_FRAME_UNIT` before anything is read.
- A missing column gives a warning (`COLUMN_MISSING`, or `TIME_COLUMN_MISSING`, `TIME_UNIT_MISMATCH`, `ROW_TIME_NEEDS_FRAME_UNIT`, `READ_FAILED`), reported once. The other series still draw. A column missing from only some files is left empty for those files' samples.
- Passing the same series with new URLs (same `logicalPath`s) only swaps URLs; loaded data is not read again.
- Auxiliary series work in single-dataset views only. On an episode set they are ignored with `EPISODE_SET_UNSUPPORTED`.

## Build a complete host

One host that edits a recording's segments, shows checks and another process's proposals, adds its own actions, follows the selection in its URL and matches its colours. Everything is passed as data and callbacks:

```tsx
import { useMemo, useState } from 'react';
import {
  LeRobotViewer,
  createEpisodeSetDataSource,
  createRemoteManifestDataSource,
  type AnnotationField,
  type LeRobotExtension,
  type TimelineMarker,
} from '@ioai/lerobot-studio';

const fields: AnnotationField[] = [
  {
    id: 'outcome',
    label: 'Outcome',
    kind: 'select',
    options: [
      { value: 'success', label: 'Success', key: '1' },
      { value: 'failure', label: 'Failure', key: '2' },
    ],
  },
  { id: 'tags', label: 'Tags', kind: 'tags' },
];

export function RecordingStudio({ view, url, navigate }: HostProps) {
  // One recording (signed files that refresh) or a set of frozen episodes (signed lazily).
  const dataSource = useMemo(
    () =>
      view.kind === 'episodeSet'
        ? createEpisodeSetDataSource(view.manifest, { resolve: (ids) => signRecordings(ids) })
        : createRemoteManifestDataSource(view.files, {
            refresh: () => fetchSignedFiles(view.id),
            expiresAt: view.expiresAt,
          }),
    [view],
  );
  const { value, saveState, onChange } = useEpisodeDocument(view.id); // your store
  const [rendition, setRendition] = useState<'original' | 'anonymized'>('original');

  // Markers: the label is display text, so localize check ids first.
  const markers: TimelineMarker[] = view.checks.map((check) => ({
    id: check.id,
    episodeIndex: 0,
    startFrame: check.startFrame,
    endFrame: check.endFrame,
    severity: check.severity, // 'info' | 'warn' | 'fail'
    label: t(`checks.${check.checkId}`),
    checkId: check.checkId,
  }));

  const extensions: LeRobotExtension[] = [
    {
      id: 'host',
      toolbar: [
        {
          kind: 'button',
          id: 'propose',
          label: t('propose'),
          icon: 'sparkles',
          variant: 'primary',
          onSelect: startProposals,
          disabled: proposalsRunning,
          disabledReason: t('proposalsRunning'),
        },
        {
          kind: 'toggle',
          id: 'rendition',
          label: t('frames'),
          options: [
            { value: 'original', label: t('original') },
            { value: 'anonymized', label: t('anonymized') },
          ],
          value: rendition,
          onChange: (next) => setRendition(next as typeof rendition),
        },
      ],
      notices: proposalsRunning
        ? [{ id: 'proposals', severity: 'info', text: t('proposing'), progress: 'indeterminate' }]
        : [],
    },
  ];

  return (
    <div style={{ height: '100%' }}>
      <LeRobotViewer
        dataSource={dataSource}
        language={locale} // BCP 47: 'zh-CN', 'zh', 'en' …; unknown tags fall back to English
        theme={colorScheme}
        themeTokens={{ primary: brand, primaryForeground: '#fff', radius: '0.5rem' }}
        annotation={{ value, onChange, saveState, createSegmentId: uuidv7 }}
        fields={fields}
        messages={{ 'segments.title': 'Episodes', 'overlay.legend': 'Proposals in progress' }}
        markers={markers}
        overlaySegments={[{ episodeIndex: 0, segments: view.proposals }]}
        extensions={extensions}
        auxiliarySeries={view.imu ? [view.imu] : undefined}
        initialSelection={{ segmentId: url.episode, timeS: url.t }}
        onSelectionChange={({ segmentId, timeS }) =>
          navigate({ episode: segmentId, t: timeS.toFixed(2) }, { replace: true })
        }
      />
    </div>
  );
}
```

Switching `rendition` passes another `dataSource` with the same frames; the viewer keeps the episode, segment and time (see [Selection and deep links](#selection-and-deep-links)).

`messages` values are ICU message strings (`{{name}}` placeholders also work). The viewer keeps its built-in copy for a key it does not document, or for a value that is not a string, such as a precompiled message array. It logs one `console.warn` per key, for example `lerobot-studio: messages["segments.row"] ignored: expected an ICU string, got array`.

### Markers and read-only suggestions

- **`markers`** are ranges (or one-frame ticks) on the time axis, coloured by `severity`, with the `label` in a tooltip and in the accessible name. Clicking one seeks to its first frame; the lane is one tab stop and arrow keys move between markers. A segment that overlaps a `warn` or `fail` marker is in the **Issues** filter and shows an issue count. `checkId` is kept for the host and never shown.
- **`overlaySegments`** are read-only segments (for example another process's proposals) in a thin band above the segment track. The band's legend is the `overlay.legend` message (default "Suggestions (read-only)"). Clicking one seeks to it; nothing in the band edits.

### Toolbar and notices

`extensions` add host controls in the viewer's own style, focus order, theme and narrow layout. They are declarative: the viewer never renders host React elements.

- `toolbar` items: `button` (`icon` `sparkles`, `refresh`, `external`, `download` or `none`; `variant` `primary` or `default`; `busy` shows a spinner and ignores presses), `toggle` (a segmented switch, a radio group to assistive technology) and `link` (`external` opens a new tab).
- A disabled button with `disabledReason` stays focusable; the reason is its tooltip and its `aria-describedby`.
- `notices` have a `severity` (`error` notices are announced at once), optional `progress` (`'indeterminate'` or 0–1) and one `action` (a link or a callback). Updating a notice re-renders only the notices, never the camera panels.
- With a sidebar they sit at its top; without one, above the playback bar.

### Selection and deep links

- `initialSelection` (`episodeIndex`, `segmentId`, `timeS`) applies once, after the first load. The viewer opens the episode (the segment's episode when only `segmentId` is given), selects the segment and lands **paused** on the frame that contains `timeS` (the segment's first frame without `timeS`).
- `onSelectionChange` reports `{ episodeIndex, segmentId, timeS }` once an episode is open: at once when the episode or segment changes, and at most four times a second while time moves. Nothing is reported while a deep link is still on its way, so the first report is where the link landed.
- Passing a new `dataSource` with the same timeline (the same episode with the same number of frames, for example another rendition of the same recording) keeps the episode, segment and frame, and keeps playing if it was playing. The shown dataset stays on screen (paused) while the new source opens, then the view changes in one step, each camera holding its last frame until the new file shows the same one (at most 4 s, then the usual loading state). The view still responds meanwhile: an episode picked during the swap is where the swap lands. If the new source fails to open, the shown one stays and the error names what failed. Another timeline opens as usual.

### Theme tokens

`themeTokens` sets `primary`, `primaryForeground`, `radius` and `fontFamily` on the viewer root (the `--primary`, `--primary-foreground` and `--radius` CSS variables and `font-family`). Values are any CSS value. Light and dark still follow `theme`; values under `themeTokens.dark` replace the others while the viewer is dark.

### Layout

- Cameras get the height first: their row takes what the frames need, at least 62 % of the panel area, and the charts below keep at least 200 px. The arrangement that shows the biggest frames is chosen (three or four cameras stay in one row while that is larger).
- Before the charts' data arrives, the chart panel shows placeholders laid out like the charts, so nothing jumps.
- One time axis: the slider, segment track, subtask track, markers, overlay band and every chart place a frame at the same fraction of their width (frame `k` of `N` starts at `k / N`; the axis ends at the end of the last frame). The lanes of the playback bar also share one left edge, and all charts share theirs.
- Below 768 px of viewer width, editable segments show one line, "Editing needs a wider window", instead of edit controls; playback, the segment list and navigation keys still work.

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

| Prop                       | Use                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `dataSource`               | Remote archive URL, remote file manifest, or a custom `DataSource`                     |
| `theme`                    | `light`, `dark`, or `system`                                                           |
| `language`                 | `en`, `zh`, or `ja` (`zh` and `ja` load on demand, before the first render)            |
| `showSidebar`              | Show or hide the episode sidebar                                                       |
| `showPlaybackBar`          | Show or hide playback controls                                                         |
| `enableKeyboardShortcuts`  | Enable or disable viewer shortcuts                                                     |
| `onFatalError`             | Receive a loading error and render your own error state                                |
| `onExport`                 | Respond when a user clicks your export button                                          |
| `auxiliarySeries`          | Extra time series to plot; see [Plot extra time series](#plot-extra-time-series)       |
| `onAuxiliarySeriesWarning` | Receive auxiliary-series warnings                                                      |
| `annotation`               | Host-controlled segments: `value`, `onChange`, `saveState`                             |
| `readOnly`                 | Show segments and review without any edit control                                      |
| `fields`                   | Values a person sets on each segment (`select`, `tags`, `text`)                        |
| `messages`                 | Replace built-in segment copy by key                                                   |
| `markers`                  | Ranges on the time axis by severity; see [Markers](#markers-and-read-only-suggestions) |
| `overlaySegments`          | Read-only segments in a band above the segment track                                   |
| `extensions`               | Host toolbar items and notices; see [Toolbar and notices](#toolbar-and-notices)        |
| `initialSelection`         | Open at an episode, segment and time, once                                             |
| `onSelectionChange`        | Follow episode, segment and time; see [Selection](#selection-and-deep-links)           |
| `themeTokens`              | Host colours, radius and font on the viewer root                                       |

`onExport` is a callback only. It does not include the standalone app's export engine.

When you provide `onFatalError`, the viewer does not render its built-in fatal-error state. Keep the error in your application state and display an appropriate message yourself.

For segments, review and change ops, see [API — Segments and review](./api.md#segments-and-review). For custom `DataSource` implementations and the full type list, see [API reference](./api.md).

## Integration notes

- Give the viewer's parent an explicit height.
- The viewer's root is a labelled `region` landmark (never `main`), so it can sit inside your page's own `main`.
- Each camera's declared codec (`info.features[key].info["video.codec"]`) is checked before loading. If the browser cannot decode it, the camera shows a notice naming the codec instead of a broken player.
- For a remote archive, check CORS and HTTP Range headers.
- In Next.js, keep the viewer in a Client Component with `ssr: false`.
- For built-in export, use the standalone application. Welcome-page helpers only help you pick data and build a local `DataSource`.
