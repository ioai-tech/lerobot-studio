# Data formats

> **Language / 语言：** [English](./data-formats.md) | [简体中文](/zh-CN/data-formats)

`v2.1` and `v3.0` are fully supported. Newer minor versions in the `v2` and `v3` families may open in read-only mode. Other versions, including `v2.0`, missing versions, and future major versions, are rejected.

---

## Versions

| `codebase_version`                               | Features      | Export                                  |
| ------------------------------------------------ | ------------- | --------------------------------------- |
| `v2.1`                                           | View and edit | Verified with official LeRobot `v0.6.1` |
| `v3.0`                                           | View and edit | Same                                    |
| Newer `v2` or `v3` minor version                 | View only     | Not available                           |
| `v2.0`, other major versions, or missing version | Not opened    | Not available                           |

More runtime notes: [Compatibility](./compatibility.md).

---

## Inputs

| Input          | Notes                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Local archive  | `.zip`, `.tar`, `.tar.gz`, `.tgz`                                                                           |
| Local folder   | Drag or select a folder in supported browsers; only File System Access handles can be restored after reload |
| Remote archive | CORS `GET`; large files also need Range — [CORS](./cors.md)                                                 |
| Custom         | Implement [`DataSource`](./api.md)                                                                          |

Archives are treated as untrusted input. A failed load does not change the source files.

---

## Export (standalone app only)

Export is available only in the hosted or self-hosted standalone application, not in the npm viewer API.

For v3, Parquet files roll by size and `chunks_size` caps files per chunk. Videos use one MP4 per episode. The exported layout is not byte-identical to the official sharding scheme, but it has been verified with the pinned LeRobot `v0.6.1` reader.
