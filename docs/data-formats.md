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

### Subtasks

Subtasks are optional. When present they follow the official LeRobot `v3.0` mapping:

- `meta/subtasks.parquet`: pandas string index `subtask` plus `subtask_index` (int64)
- `info.features.subtask_index`: `{ "dtype": "int64", "shape": [1], "names": null }`
- frame parquet column `subtask_index`

A dataset without subtasks is exported without these files or the feature. `v3.0` export with subtasks requires complete frame coverage. Export to `v2.1` strips subtask columns and `meta/subtasks.parquet`. The original `task` / `task_index` fields are never overwritten.

Studio reads official `subtask_index` only. Community snapshots that store `subtask_id` instead are opened as ordinary `v3.0` data, but subtask segments are not shown. Missing `meta/subtasks.parquet` is allowed: labels fall back to `Subtask N`. Official unlabeled frames may use `subtask_index = -1`; Studio treats those as unlabeled and never writes `-1` on export. Extra official columns such as `task_index_high_level` are preserved. A `v3.0` export with subtasks always writes `meta/subtasks.parquet`.

#### Official Hub examples {#official-hub-examples}

Download with the Hugging Face CLI (`hf`), then open the local folder in Studio:

```bash
hf download lerobot/libero_10_subtask --type=dataset --local-dir /data/lerobot/libero_10_subtask
hf download lerobot/pusht-subtask --type=dataset --local-dir /data/lerobot/pusht-subtask
hf download k1000dai/libero-subtaskid-segments --type=dataset --local-dir /data/lerobot/libero-subtaskid-segments
hf download lerobot/outdoor-depth --type=dataset --local-dir /data/lerobot/outdoor-depth
```

| Hub repo                                                                                                   | What it contains                                                                                                                       | Studio                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`lerobot/libero_10_subtask`](https://huggingface.co/datasets/lerobot/libero_10_subtask)                   | Official `v3.0` with frame `subtask_index`. Labels parquet may be absent.                                                              | View indices as `Subtask N`; annotate and export `v3.0`.                 |
| [`lerobot/pusht-subtask`](https://huggingface.co/datasets/lerobot/pusht-subtask)                           | Official `v3.0` with `meta/subtasks.parquet` (`phase 1/2/3`) and unlabeled `-1` frames.                                                | View labels; unlabeled frames stay empty; export requires full coverage. |
| [`k1000dai/libero-subtaskid-segments`](https://huggingface.co/datasets/k1000dai/libero-subtaskid-segments) | `v3.0` snapshot that uses `subtask_id` instead of official `subtask_index`.                                                            | Opens for viewing; subtask segments are not mapped.                      |
| [`lerobot/outdoor-depth`](https://huggingface.co/datasets/lerobot/outdoor-depth)                           | Official `v3.0` depth-only dataset. Frames are 16-bit grayscale TIFF in parquet (`is_depth_map: true`, `depth_unit: mm`). No subtasks. | Decodes TIFF depth maps and plays a false-color preview.                 |
