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

## 查看器的部分内容加载失败

布局、片段面板和部分对话框在首次使用时作为单独的文件加载。如果其中一个无法获取（常见于标签页保持打开期间进行了新部署），其位置会显示“查看器的部分内容加载失败（CHUNK_LOAD_FAILED）”和 **重试** 按钮；查看器的其余部分照常工作。如果重试仍然失败（浏览器可能缓存了失败的模块请求），提示中还会提供 **重新加载页面**。

---

## 数据集显示前提示"当前处于离线状态"

数据集显示之前，浏览器报告已离线。查看器会继续打开（读取成功时数据集照常显示）；离线时失败的打开会以 `NETWORK_OFFLINE` 报告给使用 `onFatalError` 的宿主。浏览器恢复在线后，查看器会自行重新打开数据集；点击**重试**会立即尝试。

元数据文件存在但无法读取（网络错误、404 以外的 HTTP 状态码）时，会报告为 `DATASET_READ_FAILED: could not read <路径>` 并附上原因，不会被报告为数据集无效。文件缺失（404）属于数据集校验失败。

---

## Parquet 读取器无法加载

以 `PARQUET_ENGINE_UNAVAILABLE` 结束的打开，表示 Parquet 读取器未能启动，数据集并未被读取。错误信息会注明原因：

- **worker script could not load**：页面的内容安全策略（`worker-src` 或 `script-src`）不允许 Worker 脚本，或服务器没有提供打包器输出的资源。
- **could not compile … Content Security Policy**：服务器为 Worker 脚本发送的 CSP 不含 `'wasm-unsafe-eval'`。请在该策略中加入它，或不再为静态资源发送 CSP。
- **HTTP 404** 或 **could not download**：WASM 文件没有在打包器输出的 URL（或传给 `setParquetWasmUrl` 的 URL）上提供，其他来源的 CDN 未允许 CORS，或随 Worker 脚本下发的 CSP 中 `connect-src` 不允许 WASM 的来源（此时消息以 `TypeError: Failed to fetch` 结尾）。
- 不涉及 CSP 的 **could not compile … CompileError**：文件已损坏，或不是本包的 WASM（例如一个 HTML 错误页）。

见 [Worker、WebAssembly 与内容安全策略](./embedding#worker、webassembly-与内容安全策略)。重试会启动新的 Worker，并重新下载该文件。

---

## 看不到子任务

Studio 只映射官方 LeRobot 的 `subtask_index`。

- `lerobot/libero_10_subtask` 在缺少 `meta/subtasks.parquet` 时显示 `Subtask N`。
- `lerobot/pusht-subtask` 显示 `phase 1/2/3`；`subtask_index = -1` 的帧保持为 **未标注**。
- `k1000dai/libero-subtaskid-segments` 使用 `subtask_id` 而不是 `subtask_index`，因此不会显示分段。
- `v2.1` 可以显示已有索引，但不能新增标注。

下载命令见 [数据格式 — 官方 Hub 示例](./data-formats#official-hub-examples)。勾选 **包含子任务** 后，导出为 `v3.0` 时每个被导出帧都必须已标注；应用不会写入 `-1`。

---

## 深度图空白或无法解码

官方深度数据集（如 [`lerobot/outdoor-depth`](https://huggingface.co/datasets/lerobot/outdoor-depth)）把 16 位灰度 TIFF 存在 parquet 中（`info.is_depth_map: true`）。Studio 会识别 TIFF/PNG/JPEG，将 16 位深度伪彩化后播放，而不是只按 JPEG 解码。若面板一直空白，请确认 feature 的 dtype 是 `image` 或 `depth`，并且存在 `observation.images.*`。

---

## Next.js 出现服务端错误

请使用 Client Component 和 `dynamic(..., { ssr: false })`。该包只能在浏览器中运行。见 [嵌入指南](./embedding)。

---

## 自定义 DataSource 出现内存泄漏

请在 `invalidateObjectUrl()` / `clear()` 中撤销 object URL、释放归档句柄，并避免无限保留完整文件缓冲区。生命周期由宿主应用负责管理，详见 [API](./api)。
