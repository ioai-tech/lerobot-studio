# Data formats

> **Language / 语言：** [English](./data-formats.md) | [简体中文](./data-formats.zh-CN.md)

Format support is version-specific. A matching major prefix is not enough:
`v2.0`, future `v2.x`, future `v3.x`, malformed values, and missing
`codebase_version` are unknown formats.

## 1.0 format matrix

| Declared version           | Open and inspect                                    | Export                                   | Status                            |
| -------------------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------------- |
| Exactly `v2.1`             | Automated CI verified                               | Official reader roundtrip verified in CI | CI verified; release gate pending |
| Exactly `v3.0`             | Automated CI verified                               | Official reader roundtrip verified in CI | CI verified; release gate pending |
| Missing or any other value | Warning-marked read-only mode when safely parseable | Prohibited (enforced in CI)              | CI verified; release gate pending |

These entries reflect automated verification in CI. Advertising a capability as
generally supported for the `1.0.0` release still requires the final manual
release gate. See [Compatibility and release gates](./compatibility.md) for the
full matrix and acceptance checklist.

## Inputs

- Local archives: ZIP, TAR, or TAR.GZ through the public archive factory.
- Local directories: require File System Access API support; other browsers
  may offer an archive-only fallback.
- Remote archives: require cross-origin `GET`. Large archives also require
  working byte ranges.
- Custom sources: implement the stable [`DataSource`](./api.md) contract.

Archive contents and paths are untrusted input. Loading must fail safely and
must not modify the source dataset.

## Parquet and video sharding

For v3 export, Studio rolls Parquet files by the configured data-file size and
uses `chunks_size` as the maximum file count in each chunk.

Video layout differs from official LeRobot:

- Studio currently writes one MP4 per episode and rolls video chunks by file
  count.
- Official LeRobot may losslessly concatenate multiple episode videos into one
  size-bounded MP4.

Studio therefore does **not** claim byte-for-byte video sharding parity.
Per-episode layout and metadata references are verified in CI against the
pinned official LeRobot `v0.6.1` reader. Advertising export as generally
supported still requires the final manual release gate; export remains outside
the stable npm API until then.
