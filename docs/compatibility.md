# Compatibility

> **Language / 语言：** [English](./compatibility.md) | [简体中文](/zh-CN/compatibility)

This page lists the versions and environments verified for `1.0.0`. Test results from 2026-08-05 are available in [Release evidence](./release-evidence-1.0.0.md).

---

## Summary

| Topic            | Supported behavior                                                           |
| ---------------- | ---------------------------------------------------------------------------- |
| React            | `^19.0.0`                                                                    |
| Bundle           | ESM and browser client-side rendering                                        |
| Datasets         | `v2.1` and `v3.0` are fully supported                                        |
| Other versions   | Only newer `v2` and `v3` minor versions open read-only                       |
| Telemetry        | The npm package does not send usage data                                     |
| Breaking changes | Semantic versioning within major version 1 — [deprecation](./deprecation.md) |

Vite applications and client-only Next.js integrations are covered in CI.

---

## Datasets

| `codebase_version`                               | Available features | Export                                             |
| ------------------------------------------------ | ------------------ | -------------------------------------------------- |
| `v2.1`                                           | View and edit      | Verified with the official LeRobot `v0.6.1` reader |
| `v3.0`                                           | View and edit      | Same                                               |
| Newer `v2` or `v3` minor version                 | View only          | Not available                                      |
| `v2.0`, other major versions, or missing version | Not opened         | Not available                                      |

Fully supported versions use exact matching. Only newer minor releases in the `v2` and `v3` families receive read-only compatibility. The app does not treat other versions, including future major versions, as compatible.

Export is available in the standalone application, not in the npm API. Its output is checked with LeRobot `v0.6.1`. Video layout notes: [Data formats](./data-formats.md).

`v3.0` subtask viewing and export are checked against official Hub datasets [`lerobot/libero_10_subtask`](https://huggingface.co/datasets/lerobot/libero_10_subtask) and [`lerobot/pusht-subtask`](https://huggingface.co/datasets/lerobot/pusht-subtask). Download commands: [Data formats — Official Hub examples](./data-formats.md#official-hub-examples).

---

## Inputs

| Input          | Expectation                                                                             |
| -------------- | --------------------------------------------------------------------------------------- |
| Local archive  | `.zip` / `.tar` / `.tar.gz` / `.tgz`                                                    |
| Local folder   | Drag or select a folder; non-File-System-Access browsers cannot restore it after reload |
| Remote archive | CORS + Range for big files — [CORS](./cors.md)                                          |
| Samples        | Optional; only if you set sample env vars at build time                                 |

Authentication, signed URLs, and proxies are configured by the embedding application or deployment.

---

## Browsers

See [Browser support](./browser.md). Chromium receives full browser coverage; Firefox and WebKit receive smoke coverage. Video playback also depends on codec support.

The fixed validation reader is LeRobot `v0.6.1`. A nightly job also checks the upstream `main` branch; it does not block releases.
