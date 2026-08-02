# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Unreleased

### Added

- npm workspaces layout: `apps/web`, `packages/core`, `packages/platform`, `packages/react`, `packages/ui`
- Published package identity `@ioai/lerobot-studio` (MIT)
- Shared `ViewerLayout` for app and library shells
- `LeRobotStudioProvider` public composition root
- Minimal synthetic LeRobot v2/v3 fixtures under `tests/fixtures/datasets`
- GitHub Actions CI, nightly browser tests, and release workflow (npm + GHCR)

### Removed

- Internal GitLab CI / private deploy configuration
- Google Analytics and Microsoft Clarity from the open-source web shell
- Hardcoded monorepo `export` copy script
