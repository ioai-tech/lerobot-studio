# API

> **Language / 语言：** [English](/api) | [简体中文](./api)

本页说明 `@ioai/lerobot-studio` 的公开 API。这个包提供查看器、归档辅助函数及其类型；不包含独立应用中的导出引擎。

文末自动生成的报告是完整 API 参考。修改源码后运行 `npm run api:report`，不要直接编辑生成的报告。

---

## 示例

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

<LeRobotViewer dataSource="https://example.com/dataset.zip" theme="system" />;
```

`dataSource` 可以是远程归档 URL，也可以是自定义 `DataSource`：

- `createArchiveDataSourceFromFile` — 本地 ZIP / TAR / TAR.GZ
- `createArchiveDataSourceFromUrl` — 要复用的远程归档
- `createRemoteManifestDataSource` — 宿主已签名的逐文件 HTTP(S) URL 清单

数据集支持时，查看器可以在当前会话中修改 Episode。`onExport` 只是宿主 UI 的回调，不会自行导出数据。

---

## 自定义数据源

如果应用需要按路径读取字节或文本，请实现 `DataSource`。路径和内容都应视为不可信输入，并在 `clear()` 中释放 object URL。

加载阶段包括 `download`、`index`、`gunzip` 和 `read`。致命错误包括无效数据源、远程 URL 不可用、不支持的归档和数据集加载失败。

---

## 生成的 API 报告

<!--@include: ../etc/lerobot-studio.api.md-->
