# Changelog

## 1.7.0

### Minor Changes

- 348d7a5: Charts read only what they show, and the viewer loads less up front:

  - `DataSource.readRange(path, start, end?)` (optional, `Blob.slice` semantics) returning `ByteRangeResult`. The remote manifest, episode set and local folder sources implement it with HTTP Range / `File.slice`. Episode charts then read the parquet footer and only the selected columns' chunks of the row groups holding the episode; switching episodes in one file reuses the bytes. A server that ignores ranges costs one whole-file download, reused, with a named `RANGE_UNSUPPORTED` warning; an unknown size is the typed `RemoteSourceError` code `RANGE_SIZE_UNKNOWN` and falls back the same way.
  - Range reads combine bytes of one file version only (same size, and same `ETag` when exposed); a changed file is opened again once, then read whole (`FILE_CHANGED`), also when it changes again while a read is being planned anew. Hostile footers (spans outside the data, oversized collections, footers over 64 MiB) are refused with `FOOTER_INVALID` before any read. `ByteRangeResult.etag` (optional) carries the version.
  - Progressive charts: the time axis and the top chart group arrive first, then the other groups (placeholders with `aria-busy` meanwhile); raw-panel columns and auxiliary series are read after the charts instead of competing with them. The first chart follows the first video frame; the others are limited by their bytes on the link.
  - The segment inspector, list and dialogs, the edit dialogs, and the `zh` / `ja` messages load on demand (web initial JS −23.2 KiB gzip). A lazily loaded part that fails to load (including the layout and the batch trim dialog) shows a named `CHUNK_LOAD_FAILED` notice with a retry instead of taking the viewer down; when the retry fails too, it also offers a page reload.
  - Switching data sources while an episode loads drops the old source's load.
  - Opening a dataset requests its metadata files (episodes, tasks, subtasks) together after `info.json`, each downloaded and parsed once, instead of one after another; the shown cameras' URLs resolve with the episode's data instead of after the panels mount, and the camera panels mount once.
  - A new `dataSource` with the same timeline swaps in place. The shown dataset stays on screen while the new one opens, with no loading view. Where it lands (episode, segment, frame and play state, including an episode the person picked meanwhile) is decided once, when the new source is ready, and applied in one step. Selection, segments and edits stay; only the newest of several swaps lands, and playback resumes once its data is in. Cameras hold their last frame until the new file paints, at most 4 s (then the usual loading state), and release it at once on a load error or an aborted load. A source that fails to open leaves the shown one in place with the error; if an earlier swap was still reloading, that one finishes and lands first.
  - `messages` can replace every message an embedded viewer shows: export, batch trim, sidebar, panels, charts, health and dialogs as well as segments. Before, only `segments.*`, `overlay.*` and `markers.*` keys could be replaced. `LEROBOT_MESSAGE_KEYS` and `LeRobotMessageKey` follow the English catalog; only standalone-app copy is excluded. An override with an unknown key or a non-string value keeps the built-in copy, as before, and now logs one `console.warn` per key naming why (for example a precompiled message array).
  - A deep link to a segment and a time (`initialSelection` with `segmentId` and `timeS`) lands on that time inside the segment, and the first `onSelectionChange` reports exactly that. Before, the first report was the segment's start with no segment. Deep links and data-source swaps land through one path.
  - A camera panel that unmounts (a closed viewer, a rebuilt layout) stops loading its file at once. Before, a detached video element kept reading and held the browser's connections to the storage host, which could stall the next seek for many seconds.

- 9ea1108: Data foundations for hosted datasets:

  - `createRemoteManifestDataSource(files, { refresh, expiresAt, episodeScope })` and `RemoteFileEntry.expiresAt`: one coalesced URL refresh on 401/403 or near expiry, then one retry; a second failure is a typed `RemoteSourceError`. A refresh owns the new expiry (`refresh` may return `{ files, expiresAt }`), near-expiry refreshes are rate-limited and background refreshes back off. Videos switch to the new URL in place.
  - `createEpisodeSetDataSource(manifest, { resolve, refresh, previewVideoPath })`: episodes from many one-episode LeRobot v3 recordings, signed lazily (the first read resolves the recording and the next two; a failing prefetch never blocks the selected one); typed `EpisodeSetError`. `DataSource.focusEpisode` hints which episode is being opened.
  - `episodeScope` for v2.1 and v3.0: only scoped episodes are listed; the health report marks the rest `not_evaluated`.
  - `auxiliarySeries` / `onAuxiliarySeriesWarning` on `LeRobotViewer`: native-rate time series from separate parquet files (exact nanosecond timestamps), aligned to the playhead and shown in the charts and raw panel.
  - Playback runs on one clock (pausing lands the slider, charts and every camera on the same frame): cameras follow it (rate trim, hard seek only past 0.5 s), the chart playhead moves without repainting, and a camera whose declared codec the browser cannot decode shows a named notice.
  - Charts: one chart per feature, titled by key, dimension names from `info.features`, units when declared, the first 8 dimensions shown by default, min/max-per-pixel drawing of every sample.
  - The embedded root is a labelled `region` landmark instead of an unlabelled container; the viewer never renders `main`.
  - v3 `meta/episodes` may declare `data/file_from_index`.

- 7cfdf5e: Embedding for hosts:

  - `markers` on `LeRobotViewer`: ranges or ticks on the time axis by severity, with tooltips; a segment that overlaps a `warn` or `fail` marker is in the Issues filter and shows an issue count.
  - `overlaySegments`: read-only segments (for example another process's proposals) in a thin band above the segment track, with an `overlay.legend` message.
  - `extensions`: declarative host toolbar items (button, toggle, link) and notices with progress, rendered in the viewer's style; disabled and busy buttons stay focusable, and a disabled button's reason is its tooltip and `aria-describedby`.
  - `initialSelection` (episode, segment, time; lands paused on the frame) and `onSelectionChange` (episode and segment at once, time at most 4 per second). A new `dataSource` with the same timeline keeps the episode, segment and frame.
  - `themeTokens` (`primary`, `primaryForeground`, `radius`, `fontFamily`, with `dark` overrides) on the viewer root.
  - `auxiliarySeries` accept `timeColumn: null` with `timeUnit: 'frame'` (row `i` is frame `i`); `null` with another unit is refused with `ROW_TIME_NEEDS_FRAME_UNIT`.
  - `messages` may also replace `overlay.*` and `markers.*` copy.
  - Layout: cameras get the height first (their row takes what the frames need, at least 62 % of the panel area, charts keep 200 px) in the arrangement that shows the biggest frames; the rows are sized in place, so window or host-notice size changes never re-mount the cameras (the previous sizing read the wrong grid fields and never applied). Charts show placeholders laid out like the final charts while loading.
  - One time axis: the slider, segment and subtask tracks, markers, overlay band and charts place frame `k` of `N` at `k / N`; the total time is the end of the last frame.
  - Below 768 px of viewer width, editable segments show "Editing needs a wider window" instead of edit controls; playback and lists still work.

- d6fca01: An open that cannot reach the data now ends in a named, retryable state.

  - Offline before the dataset is shown, the viewer shows "You're offline" with Retry at once (no spinner), even while reads are still waiting, and keeps opening: the dataset appears if the reads succeed (`navigator.onLine` can be wrong). An open that fails while offline is reported to `onFatalError` as the new code `NETWORK_OFFLINE` (`recoverable: true`). When the browser is back online the viewer opens the dataset again by itself.
  - A metadata file that the dataset has but that cannot be read (network error, HTTP status) is named `DATASET_READ_FAILED: could not read <path>` with its cause, for every metadata read (v2 JSONL, v3 Parquet, `info.json`). It used to read as a format failure ("could not be parsed as Parquet", "does not exist or cannot be read"). `onFatalError` now carries the original failure as `cause`.
  - **Behaviour change for hosts:** `onFatalError` is called only while no dataset is shown. A load failure with a dataset on screen (an episode whose data cannot be read) stays inside the viewer as its error line; it used to be reported as fatal, so a host that replaces the viewer on a fatal error blanked a working view.
  - Every built-in data source reports a file missing from the dataset with one typed error, `fileNotFoundError(path)` (a `DOMException` named `NotFoundError`, now exported for custom sources); the viewer reports a missing required file as a validation failure, any other read error as `DATASET_READ_FAILED`.
  - Retry now resolves a URL data source again; before, it did nothing after a failed preflight.
  - A short panel area (for example 1024 × 768 with the segment inspector open) keeps the cameras their share of the height; the charts' 200 px floor gives way instead of shrinking the cameras to a strip.

- b34e85b: The Parquet reader's WebAssembly is a real file, downloaded and compiled only in the workers:

  - The package ships `dist-lib/assets/parquet_wasm_bg-<hash>.wasm` instead of a 6.6 MB JavaScript chunk holding it as a base64 `data:` URL. Vite, webpack 5, Turbopack (Next.js, also under a `basePath`) and Rollup emit it with their own hashed name; no configuration is needed. It transfers 31% less (1.17 MB brotli, from 1.69 MB) and the npm tarball is 20% smaller (2.43 MB, from 3.03 MB).
  - The page no longer fetches or compiles the WASM, and no longer copies it to each worker. Each worker fetches it (the HTTP cache serves later workers and visits) and compiles it while it streams when it is served as `application/wasm`. A page's Content Security Policy needs neither `'wasm-unsafe-eval'` nor `connect-src data:`; a CSP sent with the worker scripts themselves needs `'wasm-unsafe-eval'`.
  - Export writes Parquet in a worker too, so nothing is compiled on the page.
  - `setParquetWasmUrl(url)` serves the WASM from your own URL (a CDN, or a copy under your static files). It takes an absolute or relative URL string, a `URL` or `null`; any other value throws a `TypeError` starting with `INVALID_PARQUET_WASM_URL`. A change drops idle workers (the prewarmed one, export's); a viewer already open keeps its workers.
  - `preloadLeRobotViewer()` loads the viewer's layout and loader code and starts one Parquet worker before a data source exists; the next viewer adopts it, and an unadopted worker is terminated after 30 s. The viewer calls it when it mounts; hosts call it earlier, at navigation or on intent.
  - A Parquet reader that cannot load (a worker script blocked or missing, a WASM that cannot be downloaded or compiled, a message that cannot be read) ends the open with the new `onFatalError` code `PARQUET_ENGINE_UNAVAILABLE`, naming the cause, instead of an invalid-file error or a viewer that waits forever. A worker that failed does not download again; the next open starts a new one. Camera frame requests to a failed image worker miss at once (the on-demand path reports the error), and its preloads fail by name.
  - The metadata read limiter frees its slot also when a host's `readBytes` throws instead of rejecting.

- fcad2c8: Fixes from the s10 viewer walk.

  - Auto layout never leaves a camera out while its rows have room: with four cameras two to a row, ALOHA's `cam_low` was dropped after the wrist row filled (up to six cameras are laid out; more stay in the panel menu).
  - An episode opens paused on its first frame, and selecting another episode keeps the play state: paused stays paused, playing keeps playing.
  - J / K step to the next / previous episode when the segment UI is off, as ↓ / ↑ do (one key map for browse and review).
  - Proposed segments in the overlay band are as tall as segment blocks, numbered, and alternate in shade, so dozens stay readable.
  - A chart group reserves its plot's height: in a short panel the legend chips no longer sit on the plot or its x-axis; the groups scroll instead.
  - A segment row keeps each badge (Excluded, Suggested 0.33, Check warnings 1) on one line; the Excluded badge is no longer struck through.
  - A host notice puts its action under the text, so in a narrow sidebar the text keeps full lines instead of one word per line.
  - A read-only inspector shows a select field's chosen value as text (`Outcome Failure`), not as disabled toggle buttons.

- eda0a4d: Segments gain `excluded`, a host fact for a rejected range. The viewer draws an excluded segment greyed and hatched with the Excluded text on the track, in the list and in the inspector, never as confirmed or to review whatever its review state, and leaves it out of `N / M confirmed` (shown as its own count), the To review filter and `Shift+A`; `A` and the inspector's Confirm refuse it (only a to-review segment is confirmable). The segment list offers the Issues filter only when it narrows the list (some segments have an issue, some do not); a hidden filter shows All and resets the stored choice, so it does not come back silently.
- 6ac7f68: Split and review episodes with segments. A segment is an inclusive frame range inside an episode with a task, subtasks, host-declared field values and a review state (to review / confirmed); export writes each segment as its own episode, and an episode without segments exports whole. Keyboard-first review (`N`, `[`/`]`, `,`/`.`, `S`, `M`, `R`, `A`, `Shift+A`, `J`/`K`, `G`, `L`, `Ctrl/⌘+Z`, `?`), typed undo/redo with inverse changes, In/Out time fields, and a segment list with All / To review / Issues filters.

  `LeRobotViewer` gains `annotation` (host-controlled `value`, `onChange(change, { changeId })` with typed `AnnotationChange` ops, `saveState` with `refused` + `changeIds` and an authoritative `reloaded`, `createSegmentId`), `readOnly` (always wins: no edit control, no edit key), `fields` (`select` with `1`–`9` option keys, `tags`, `text`) and `messages` (replace built-in segment copy by key). `applyChange` is exported as the reference reducer.

  Breaking for the standalone app: per-episode trimming is replaced by segments; **Batch trim** becomes **Suggest segments** and adds suggested segments to review. Export option `trimRanges` and `subtaskOverlay` are replaced by `segments`, and a new **Fill gaps as "unlabeled"** option labels uncovered frames instead of refusing the export.

### Patch Changes

- 901fb9b: Keys keep working after the focused control goes away. Deleting the focused segment (R or the Delete button), a merge or undo that removes the focused row, a host removing a segment, or a focused button becoming disabled (Confirm once confirmed) used to leave focus on the page body, outside the viewer, so J, Ctrl+Z and every other key did nothing until the next click. One rule now covers every such path: focus moves to the next item of the same list (segment list or track), else the previous one, else the viewer root. The recovered row is scrolled into view, and focus that left the viewer is never pulled back.
- 217969e: A paused camera stops reading its file once the shown frame is in. Cameras read ahead (`preload="auto"`) only while playing; paused, or while the episode's data loads, they use `preload="metadata"`. Before, every paused camera kept reading ahead and held one of the browser's six HTTP/1.1 connections to the storage host that all cameras share, so with four or more cameras a seek's range reads could queue behind them.
- 52926db: `onSelectionChange` reports the last time also when it changed while a selection was on its way (a deep link or a data-source swap): the report held back meanwhile is made once the selection lands or is dropped, even when no frame change follows. Before, a swap that landed where it was could leave the host with an earlier time.

## 1.6.4

### Patch Changes

- b908f4f: Fix two embedding problems. Narrow containers (under 600px wide, measured on the viewer container rather than the window) now default to a single stacked column of panels that scrolls, and the chart panel toolbar wraps instead of clipping its line-chart and split-view controls; the desktop layout is unchanged. Every `<video>` (and the frame-extraction video and image decoder) now sets `crossOrigin="anonymous"`, so the media request and the later CORS `fetch()` of the same presigned URL share one CORS cache entry instead of the `fetch()` being blocked by a cached no-cors response; no credentials are sent.

## 1.6.3

### Patch Changes

- b065f3a: Localize hardcoded English UI strings (en/zh/ja): the episode loading status messages ("Fetching frame data for episode N...", "Loading episode N...", "Reading metadata...", "Processing charts...", "Initializing data loader..."), the "No features available" empty state, the filter "clear search" accessible label, the sample cover image alt text and the image panel load errors.

## 1.6.2

### Patch Changes

- 4636977: Localize remaining English labels in the zh locale: "全部特征", "特征" and "已复制".

## 1.6.1

### Patch Changes

- cfaeb4b: The Chart toolbar line-style key shows the full words "Action" and "State" instead of the clipped "Act" and "Sta", and wraps instead of clipping when space is tight. The sidebar episode count is localized and pluralized ("1 episode", "2 episodes", "1 个片段", "3 件のエピソード") instead of a hardcoded English "Episodes".

## 1.6.0

### Minor Changes

- 277c5bb: The embedded viewer now fills its host container. The package stylesheet is scoped to descendants of `.lerobot-root`, so the `h-full w-full` utilities on the root element itself never matched and the viewer collapsed to its content height. A base-layer `.lerobot-root` rule now sets `position: relative`, `width` / `height: 100%`, `min-width` / `min-height: 0`, and the theme `background-color` and `color`; host CSS passed through `className` still wins. In a host whose wrapper has a fixed height the viewer now stretches to it.

  Below 640px of container width (the `@container/viewer` box, not the window) the episode sidebar moves under the player and stays resizable (drag the handle, or focus it and use the arrow keys; it is named "Resize episode list" and reports its size range through `aria-valuenow`, `aria-valuemin` and `aria-valuemax`). The sidebar follows the player in DOM and focus order, is moved rather than remounted when the container crosses 640px, and keeps the width the user chose. At the same width the playback bar wraps: progress on its own row, transport centred, FPS and version hidden.

### Patch Changes

- 277c5bb: The standalone navbar keeps the dataset name clear of the controls on phones: the name truncates with an ellipsis and shows the full name on hover, and the playback-bar toggle and GitHub link hide below 640px of window width.
- 277c5bb: Playback shortcuts (Space, arrow keys) no longer fire while a widget that owns those keys has focus: tabs, sliders, radios, checkboxes, menus, listboxes and resize handles. A focused button or link keeps Space for its own activation (one press, one click), while the arrow keys still step playback there; with focus on the page or an episode row, Space plays and pauses. Element checks are realm-safe for hosts that render into another window.

## 1.5.0

### Minor Changes

- Clear `npm audit` down to zero advisories so the CI `npm audit --audit-level=high` gate goes green again. The `shadcn` CLI and its `fast-glob` → `micromatch` → `braces` chain leave the lockfile: its Tailwind theme layer is vendored at `src/ui/shadcn-tailwind.css` (byte-for-byte upstream, see the header for refresh instructions) and `src/ui/globals.css` imports that file instead of `shadcn/tailwind.css`. Scaffolding still works with `npx shadcn@latest add`. `@changesets/cli` moves from 2.31.1 to 3.0.3, which uses `picomatch` instead of `micromatch`. `braces` has no patched release (GHSA-vfj7-8cjw-p6xm), so removing every path to it is the only real fix. Tailwind CSS remains on v4.3.3 — it was already there.

## 1.4.0

### Minor Changes

- Add batch episode trim and motion-based range suggestions from Select. Calculated ranges stay in the current session until applied; export uses the same trim path as manual Edit.

## 1.3.3

### Patch Changes

- Add episode trim in Edit and apply it on export. Same-version v3.0 export copies shared videos by default and can physically drop unused segments when requested. Raise the library entry raw bundle budget to cover the trim controls in the viewer.
- Override transitive `js-yaml` 3.15.2 / 4.3.2 and `hono` 4.13.7 to clear `npm audit` (GHSA-2883-xcg3-v3hh and the hono 4.13.5+ security fixes). These packages are not runtime app dependencies.

## 1.3.2

### Patch Changes

- Ensure embedded host token binding survives the full Vite CSS asset: bind `:root` / `.dark` tokens onto `.lerobot-root` with a string pass after Lightning CSS scoping (Rule visitors fail to deserialize on the packaged stylesheet).

## 1.3.1

### Patch Changes

- Fix embedded chart colors: bind design tokens to `.lerobot-root` / `.lerobot-root.dark` so host `:root` tokens no longer win, and resolve CSS colors (oklch / nested `var()`) to canvas-safe `rgb()` for uPlot strokes and grids.

## 1.3.0

### Minor Changes

- Add public APIs for a custom welcome page: `LeRobotStudioProvider`, `LeRobotViewerContent`, `DatasetSourceSelector`, `SampleDatasetCard`, `Pagination`, `createDirectoryDataSource`, and `useDragAndDrop`. The npm package still does not include the standalone export dialog. Raise the library entry bundle budget to cover the extra welcome-page modules.
- Bump transitive `fast-uri` and `qs` to clear `npm audit`.

## 1.2.1

### Patch Changes

- Label subtasks from the playback timeline in Edit.
- Skip File System Access on insecure origins.
- Make v3.0 subtask export opt-in. Unlabeled episodes report `Episode #N has no subtask labels.`
- Fix the Docker image build: Vite no longer loads test-only parquet helpers that `.dockerignore` excludes.

## 1.2.0

### Minor Changes

- Add official LeRobot v3.0 subtask viewing, annotation, and export, plus 16-bit TIFF depth-map playback.
- Bump transitive `browserslist` to 4.28.8 to fix GHSA-c83g-rgw3-j3cx and GHSA-73wf-gq98-2v4g.

## 1.1.0

### Minor Changes

- Add `createRemoteManifestDataSource` and `RemoteFileEntry` so hosts can embed the viewer with per-file HTTP(S) URLs. Manifest sources now implement `listPaths()` so v3 episode shards can be discovered without guessing sequential paths.

## 1.0.3

### Patch Changes

- Fix unknown sample URLs, remote archive preflight hangs, camera clipping, stuck media debug overlay, and v2.1 playback into missing episode files.

## 1.0.2

### Patch Changes

- 373f5a6: Fix dark theme adaptation for sidebar chrome, dialogs, charts, and scoped studio root tokens.

## 1.0.1

### Patch Changes

- Improve dataset quality report filtering and update published package documentation.

> **Language / 语言：** [English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-05

### Added

- Single-package source layout with logical `core`, `platform`, `ui`, `react`, and `web` boundaries
- Package identity `@ioai/lerobot-studio` (MIT)
- Shared `ViewerLayout` for app and library shells
- `LeRobotStudioProvider` public composition root
- Minimal synthetic LeRobot v2/v3 fixtures under `tests/fixtures/datasets`
- GitHub Actions CI, nightly browser tests, and release workflow (npm + GHCR)
- Governance, support, security response targets, privacy disclosure,
  compatibility matrix, CODEOWNERS, and deprecation policy
- Release evidence for the approved `1.0.0` gates

### Changed

- Defined the stable 1.0 library contract as viewer-only, ESM/CSR-only,
  browser-only, React `^19.0.0`, zero telemetry, and backward compatible within
  major version 1
- Defined exact LeRobot `v2.1` and `v3.0` support; other declared versions are
  unknown rather than prefix-compatible
- Approved 1.0.0 release gates for unknown-version read-only warnings, blocked
  export, browser validation, consumer validation, and official LeRobot
  `v0.6.1` reader-consumable export
- Sample datasets are env-injected only; no sample manifest ships in the repo

### Removed

- Internal GitLab CI / private deploy configuration
- Google Analytics and Microsoft Clarity from the open-source web shell
- Hardcoded monorepo `export` copy script
- In-repo `public/sample-datasets.manifest.json`
