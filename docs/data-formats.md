# Data formats

Format support is version-specific. A matching major prefix is not enough:
`v2.0`, future `v2.x`, future `v3.x`, malformed values, and missing
`codebase_version` are unknown formats.

## Intended 1.0 matrix

| Declared version           | Open and inspect                                    | Export                         | Status   |
| -------------------------- | --------------------------------------------------- | ------------------------------ | -------- |
| Exactly `v2.1`             | Planned support                                     | Only after official validation | 1.0 gate |
| Exactly `v3.0`             | Planned support                                     | Only after official validation | 1.0 gate |
| Missing or any other value | Warning-marked read-only mode when safely parseable | Prohibited                     | 1.0 gate |

These entries describe the release contract, not a claim that the current
pre-release implementation has passed every gate. See
[Compatibility and release gates](./compatibility.md) for the acceptance
criteria.

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
Per-episode layout and metadata references have been read successfully by the
pinned official LeRobot `v0.6.1` reader, but supported export still requires
complete official training-readiness validation. Until that gate passes,
export remains experimental and outside the stable npm API.
