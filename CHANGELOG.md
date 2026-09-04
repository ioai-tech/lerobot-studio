# Changelog

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
