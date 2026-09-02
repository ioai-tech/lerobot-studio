# 数据格式

> **Language / 语言：** [English](/data-formats) | [简体中文](./data-formats)

`v2.1` 和 `v3.0` 完全支持。`v2` 和 `v3` 系列中较新的 minor 版本可能以只读方式打开；`v2.0`、缺失版本和未来主版本等其他版本会被拒绝。

---

## 版本

| `codebase_version`             | 可用功能   | 导出                             |
| ------------------------------ | ---------- | -------------------------------- |
| `v2.1`                         | 查看和编辑 | 已通过官方 LeRobot `v0.6.1` 验证 |
| `v3.0`                         | 查看和编辑 | 同上                             |
| 较新的 `v2` 或 `v3` minor 版本 | 仅查看     | 不支持                           |
| `v2.0`、其他主版本或缺失版本   | 不打开     | 不支持                           |

更多运行时说明：[兼容性](./compatibility)。

---

## 输入

| 输入       | 说明                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 本地归档   | `.zip`、`.tar`、`.tar.gz`、`.tgz`                                              |
| 本地文件夹 | 在受支持的浏览器中可拖放或选择目录；只有 File System Access 句柄可在刷新后恢复 |
| 远程归档   | 要 CORS `GET`；大文件还要 Range — [CORS](./cors)                               |
| 自定义     | 实现 [`DataSource`](./api)                                                     |

归档内容会作为不可信输入处理。加载失败不会修改源文件。

---

## 导出（仅独立应用）

导出功能只在托管或自托管的独立应用中提供，不属于 npm 查看器 API。

v3 按文件大小切分 Parquet，并通过 `chunks_size` 限制每个 chunk 的文件数。视频每个 Episode 使用一个 MP4。导出的分片布局不保证与官方产物逐字节一致，但已通过固定版本 LeRobot `v0.6.1` 读取器验证。

### 子任务

子任务是可选字段。存在时遵循官方 LeRobot `v3.0` 映射：

- `meta/subtasks.parquet`：pandas 字符串索引 `subtask`，以及 `subtask_index`（int64）
- `info.features.subtask_index`：`{ "dtype": "int64", "shape": [1], "names": null }`
- 帧 parquet 列 `subtask_index`

没有子任务的数据集导出时不会写入这些文件或 feature。带标注的 `v3.0` 导出会要求每一帧都已覆盖。导出为 `v2.1` 时会去掉子任务列和 `meta/subtasks.parquet`。原始的 `task` / `task_index` 不会被覆盖。

Studio 只读取官方的 `subtask_index`。使用 `subtask_id` 的社区快照仍可按普通 `v3.0` 打开，但不会显示子任务分段。缺少 `meta/subtasks.parquet` 是允许的：标签会回退为 `Subtask N`。官方未标注帧可能是 `subtask_index = -1`；Studio 将其视为未覆盖，导出时不会写入 `-1`。额外的官方列（如 `task_index_high_level`）会保留。带有子任务的 `v3.0` 导出始终写入 `meta/subtasks.parquet`。

#### 官方 Hub 示例 {#official-hub-examples}

用 Hugging Face CLI（`hf`）下载后，在 Studio 中打开本地文件夹：

```bash
hf download lerobot/libero_10_subtask --type=dataset --local-dir /data/lerobot/libero_10_subtask
hf download lerobot/pusht-subtask --type=dataset --local-dir /data/lerobot/pusht-subtask
hf download k1000dai/libero-subtaskid-segments --type=dataset --local-dir /data/lerobot/libero-subtaskid-segments
hf download lerobot/outdoor-depth --type=dataset --local-dir /data/lerobot/outdoor-depth
```

| Hub 仓库                                                                                                   | 内容                                                                                                               | Studio                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [`lerobot/libero_10_subtask`](https://huggingface.co/datasets/lerobot/libero_10_subtask)                   | 官方 `v3.0`，帧级 `subtask_index`。标签 parquet 可能缺失。                                                         | 以 `Subtask N` 查看索引；可标注并导出 `v3.0`。     |
| [`lerobot/pusht-subtask`](https://huggingface.co/datasets/lerobot/pusht-subtask)                           | 官方 `v3.0`，含 `meta/subtasks.parquet`（`phase 1/2/3`），未标注帧为 `-1`。                                        | 显示官方标签；未覆盖帧保持空白；导出需要完整覆盖。 |
| [`k1000dai/libero-subtaskid-segments`](https://huggingface.co/datasets/k1000dai/libero-subtaskid-segments) | `v3.0` 快照，使用 `subtask_id` 而非官方 `subtask_index`。                                                          | 可以打开查看；不会映射子任务分段。                 |
| [`lerobot/outdoor-depth`](https://huggingface.co/datasets/lerobot/outdoor-depth)                           | 官方 `v3.0` 纯深度数据集。帧是 parquet 里的 16 位灰度 TIFF（`is_depth_map: true`，`depth_unit: mm`）。没有子任务。 | 解码 TIFF 深度图并以伪彩预览播放。                 |
