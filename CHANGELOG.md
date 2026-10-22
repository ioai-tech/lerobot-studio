# Changelog

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
