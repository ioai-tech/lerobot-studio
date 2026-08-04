# Compatibility and release gates

> **Language / 语言：** [English](./compatibility.md) | [简体中文](./compatibility.zh-CN.md)

This document separates the stable `1.0.0` contract from final release
approval. Rows marked **CI verified; release gate pending** pass automated
acceptance checks (unit, browser, and official LeRobot compatibility jobs).
They must not be advertised as generally supported until maintainers complete
the final manual release gate for `1.0.0`.

## Runtime contract

- React and React DOM: `^19.0.0`
- Module format: ESM only
- Rendering: client-side rendering only
- Runtime: modern browsers only; Node.js, CommonJS, React Server Components,
  server-side rendering, and hydration of server-rendered viewer markup are out
  of scope
- Compatibility: public APIs remain backward compatible throughout major
  version 1, subject to the [deprecation policy](./deprecation.md)
- Telemetry: zero telemetry in the npm library

The package metadata declares this React peer range. Validating Vite and Next.js
client-only consumers remains a 1.0 release gate.

## Dataset support

| Dataset `codebase_version` | Open and inspect                               | Export                                   | Status                            |
| -------------------------- | ---------------------------------------------- | ---------------------------------------- | --------------------------------- |
| Exactly `v2.1`             | Automated CI verified                          | Official reader roundtrip verified in CI | CI verified; release gate pending |
| Exactly `v3.0`             | Automated CI verified                          | Official reader roundtrip verified in CI | CI verified; release gate pending |
| Missing or any other value | Warning-marked read-only when safely parseable | Prohibited (enforced in CI)              | CI verified; release gate pending |

“Exact” applies to the declared dataset version, not a prefix family. In
particular, `v2.0`, future `v2.x`, future `v3.x`, and malformed or missing
versions are unknown. Unknown data must never silently select a compatible
adapter. If safe parsing is impossible, loading must fail without modifying the
source.

Supported export means that the complete exported dataset can be consumed by
the corresponding official LeRobot release for training without manual repair.
The validation fixture set covers metadata, tasks, episodes, Parquet data,
timestamps, images/video, and cross-version export where offered. CI verifies
these paths against the pinned official LeRobot `v0.6.1` reader; advertising
export as generally supported still requires the final manual release gate.

For v3 data, Studio rolls Parquet files by the configured data-file size and
uses `chunks_size` as the maximum number of files per chunk. Browser export
currently keeps each episode video in a separate MP4 and rolls video chunks by
file count. Official LeRobot may losslessly concatenate several episode videos
into one size-bounded MP4; Studio does not claim byte-for-byte sharding parity,
but its per-episode layout and metadata references are validated by the official
v0.6.1 reader.

## Input and network support

| Input           | Contract                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------- |
| Local archive   | Browser-local read; archive types shown by the UI must be tested before 1.0                  |
| Local directory | Requires the File System Access API; fallback selection may not preserve a restorable handle |
| Remote archive  | Requires cross-origin `GET`; byte-range access is required for scalable large-archive use    |
| Sample URL      | Same origin, CORS, and Range rules as any remote archive                                     |

For remote archives, the origin should:

- answer the preflight or request with an appropriate
  `Access-Control-Allow-Origin`;
- allow `GET` and the `Range` request header when preflighted;
- expose `Content-Range`, `Accept-Ranges`, and `Content-Length` when the client
  needs to inspect them; and
- respond to a valid byte request with `206 Partial Content` and a valid
  `Content-Range`.

A server that ignores Range may force a full download and is not considered a
supported large-dataset configuration. Authentication, private object-store
credentials, signed-URL generation, and proxying are host-application
responsibilities.

## Browser capability matrix

The automated matrix uses Playwright Chromium, Firefox, and WebKit. “Smoke”
means Viewer composition, localized error states, keyboard/accessibility
primitives, unknown-version read-only behavior, and remote/custom `DataSource`
contracts. It does not imply codec support for every dataset.

| Capability                              | Chromium (Chrome/Edge)                           | Firefox                                    | WebKit (Safari engine)                     |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| Viewer/error/accessibility/read-only    | CI smoke                                         | CI smoke                                   | CI smoke                                   |
| Remote or custom `DataSource`           | CI smoke                                         | CI smoke                                   | CI smoke                                   |
| Local archive viewing                   | Extended validation pending                      | Extended validation pending                | Extended validation pending                |
| Directory picker and restorable handles | File System Access capability detected           | Explicit ZIP-only fallback when absent     | Explicit ZIP-only fallback when absent     |
| ZIP download                            | Capability detected; export suite verified in CI | Capability detected in smoke               | Capability detected in smoke               |
| Directory export                        | Chromium-only; requires File System Access       | Not run; directory option must stay absent | Not run; directory option must stay absent |
| Video encoding/export                   | Full browser export suite, including WebCodecs   | Not run; WebCodecs capability is detected  | Not run; WebCodecs capability is detected  |
| Video decode/playback                   | Dataset/codec dependent                          | Dataset/codec dependent                    | Dataset/codec dependent                    |

CI installs all three engines. Chromium retains the complete browser suite,
including export and encoding scenarios. Firefox and WebKit run only the smoke
scope above; a missing browser capability is tested as an explicit degradation
contract rather than converted into a skipped test.

The pinned official compatibility gate uses LeRobot `v0.6.1` commit
`7e241bd630a3719a56157a497ce5d08f244784f1`. Nightly also checks the current
upstream `main` as a non-blocking warning job. Exact browser versions must be
recorded in release evidence. A browser being “modern” does not guarantee codec
support; unsupported media must produce a clear error while non-media
inspection remains available where safe.

## 1.0 acceptance gates

- Enforce exact `v2.1` and `v3.0` detection (**automated CI verified**).
- Provide a visible warning and immutable mode for unknown versions; disable
  every export entry point and service call in that mode (**automated CI
  verified**).
- Validate supported exports with official LeRobot training workflows (**CI
  verified**; final manual release approval still pending).
- Keep React peer dependencies at `^19.0.0` and test Vite and Next.js
  client-only consumers.
- Run the browser matrix and retain versioned evidence.
- Confirm the npm artifact has no telemetry or host-application side effects
  beyond documented browser storage.
