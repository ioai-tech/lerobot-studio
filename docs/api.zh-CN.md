# 稳定 API

> **Language / 语言：** [English](./api.md) | [简体中文](./api.zh-CN.md)

生成的 API 报告是可发布表面的权威来源。稳定 `1.0` 契约为 **仅查看**：包含查看器、浏览器数据源工厂及其公开类型。产品内部实现、源数据修改、编辑与导出服务不属于公开 API。

::: warning 发布状态
包正在准备 `1.0.0`，尚未发布。API 报告描述目标稳定公开面，但发布仍取决于 [1.0 发布门禁](./compatibility)。
:::

## 主入口

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

<LeRobotViewer
  dataSource="https://example.com/dataset.zip"
  theme="system"
  onFatalError={(error) => {
    console.error(error.code, error.message);
  }}
/>;
```

`dataSource` 接受远程归档 URL 或自定义 `DataSource`。本地 ZIP、TAR 或 TAR.GZ 归档请用 `createArchiveDataSourceFromFile`；需要可复用的远程源时用 `createArchiveDataSourceFromUrl`。

可选的 `onExport` 属性仅是宿主拥有的 UI 回调。它不会导出数据，也不会使导出成为稳定 npm API 的一部分。

## 自定义数据源

自定义 `DataSource` 按路径提供浏览器可读的字节与文本。它也可提供路径列表与 object URL 生命周期方法。实现必须将数据集内容视为不可信输入，并应在 `clear()` 中释放 object URL 与其他资源。

进度回调使用 `download`、`index`、`gunzip`、`read` 加载阶段。致命查看器错误分为无效源、远程源不可用、不支持的归档或数据集加载失败。

## 生成的 API 报告

以下章节直接引用 `etc/lerobot-studio.api.md`。该文件由 API Extractor 自动生成，**请勿手工翻译**。请通过库源码与 `npm run api:report` 更新公开声明；不要在此重复或手改报告。

完整例外说明见 [文档国际化例外清单](./i18n-exceptions)。

<!--@include: ../etc/lerobot-studio.api.md-->
