# Release evidence — 1.0.0

> **Language / 语言：** [English](./release-evidence-1.0.0.md) | [简体中文](/zh-CN/release-evidence-1.0.0)

Maintainer approval date: **2026-08-05**  
Pinned official LeRobot: **v0.6.1** @ `7e241bd630a3719a56157a497ce5d08f244784f1`

## Automated gates (local re-run)

| Gate                                        | Command / artifact                                                                                                | Result                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Unit + versioning                           | `npm run test:unit`                                                                                               | 236 passed, 4 skipped      |
| Official reader roundtrip                   | `LEROBOT_PYTHON=… npm run test:compat`                                                                            | 4 passed                   |
| Browser smoke (Chromium / Firefox / WebKit) | `npm run test:browser:smoke`                                                                                      | 45 passed                  |
| Archive types UI declares                   | `.zip`, `.tar`, `.tar.gz`, `.tgz` via `SourceController` + `archive-datasource` / `datasource-input-safety` tests | Covered                    |
| Zero telemetry                              | No analytics scripts in app shell; see [Privacy](./privacy.md)                                                    | Confirmed in source review |
| Typecheck                                   | `npm run typecheck`                                                                                               | Passed                     |

Playwright version recorded for this approval: **1.62.1**.

Official training-ready export is approved on the **`LeRobotDataset` /
`LeRobotDatasetMetadata` load path** exercised by `tests/compat/*`. That is the
project’s defined training-consumption gate for 1.0.0 (load without manual
repair). End-to-end GPU policy training is outside this repository’s CI and is
not required for the 1.0.0 advertisement boundary.

## npm / consumer

- Package identity: `@ioai/lerobot-studio@1.0.0`
- Consumer verification: CI `npm-consumer` + `test:npm-consumer:docker` (Vite /
  Next client-only)
- Peer React: `^19.0.0`

## Samples

Sample archives are **not** shipped in the repository. Hosted demos may set
`VITE_SAMPLE_DATASETS_MANIFEST_URL` at build time.

## Third-party

See [NOTICE](https://github.com/ioai-tech/lerobot-studio/blob/main/NOTICE) for
`mediabunny` (MPL-2.0) and Geist (OFL-1.1).
