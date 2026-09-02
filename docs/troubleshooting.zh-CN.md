# 故障排查

> **Language / 语言：** [English](/troubleshooting) | [简体中文](./troubleshooting)

## 查看器是空白 / 高度为 0

组件会填满父元素，请为父元素设置明确高度。

```tsx
<div style={{ height: 720, minHeight: 480 }}>
  <LeRobotViewer dataSource={source} />
</div>
```

---

## 远程归档打不开

1. 确认从查看器所在的源站可以请求最终 URL。
2. 检查重定向：每一个响应都需要正确的 CORS 响应头。
3. 对较大的归档发起范围请求，确认返回 `206` 和有效的 `Content-Range`。
4. 服务器不支持范围请求时，较小的归档可回退为完整的 `200` 下载；该回退仅适用于小于 2 GiB 的归档。
5. 使用范围请求时，将 `Accept-Ranges`、`Content-Length`、`Content-Range` 暴露给浏览器代码。
6. 检查签名 URL 是否已过期，或 CDN 是否移除了 `Range` 请求头。

示例见 [CORS](./cors)。

---

## 归档类型被拒

支持 ZIP、TAR、TAR.GZ 和 TGZ。远程文件需要通过 URL 或响应头识别格式。处理 `onFatalError`，以区分 `UNSUPPORTED_ARCHIVE` 和网络错误。

---

## 打开了但有警告

`v2.1` 和 `v3.0` 完全支持。其他版本在能够安全解析时可能以只读方式打开，且不能导出。

---

## 没视频

播放取决于视频编解码器和浏览器。请在目标浏览器中尝试该文件并检查媒体错误。即使视频无法播放，图表和原始数据仍可能可用。

---

## 看不到子任务

Studio 只映射官方 LeRobot 的 `subtask_index`。

- `lerobot/libero_10_subtask` 在缺少 `meta/subtasks.parquet` 时显示 `Subtask N`。
- `lerobot/pusht-subtask` 显示 `phase 1/2/3`；`subtask_index = -1` 的帧保持为 **未标注**。
- `k1000dai/libero-subtaskid-segments` 使用 `subtask_id` 而不是 `subtask_index`，因此不会显示分段。
- `v2.1` 可以显示已有索引，但不能新增标注。

下载命令见 [数据格式 — 官方 Hub 示例](./data-formats#official-hub-examples)。导出为 `v3.0` 时，每个被导出帧都必须已标注；应用不会写入 `-1`。

---

## 深度图空白或无法解码

官方深度数据集（如 [`lerobot/outdoor-depth`](https://huggingface.co/datasets/lerobot/outdoor-depth)）把 16 位灰度 TIFF 存在 parquet 中（`info.is_depth_map: true`）。Studio 会识别 TIFF/PNG/JPEG，将 16 位深度伪彩化后播放，而不是只按 JPEG 解码。若面板一直空白，请确认 feature 的 dtype 是 `image` 或 `depth`，并且存在 `observation.images.*`。

---

## Next.js 出现服务端错误

请使用 Client Component 和 `dynamic(..., { ssr: false })`。该包只能在浏览器中运行。见 [嵌入指南](./embedding)。

---

## 自定义 DataSource 出现内存泄漏

请在 `invalidateObjectUrl()` / `clear()` 中撤销 object URL、释放归档句柄，并避免无限保留完整文件缓冲区。生命周期由宿主应用负责管理，详见 [API](./api)。
