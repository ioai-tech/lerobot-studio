# Changelog

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
