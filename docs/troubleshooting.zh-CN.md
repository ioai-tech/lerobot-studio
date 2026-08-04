# 故障排查

> **Language / 语言：** [English](./troubleshooting.md) | [简体中文](./troubleshooting.zh-CN.md)

## 查看器高度为零

`LeRobotViewer` 会填满其容器。为宿主元素提供明确高度，或提供可解析为非零高度的布局约束。

```tsx
<div style={{ height: 720, minHeight: 480 }}>
  <LeRobotViewer dataSource={source} />
</div>
```

## 远程归档无法打开

1. 确认最终 URL 可从查看器源用 `GET` 访问。
2. 检查重定向；每个最终响应须保留必需的 CORS 头。
3. 发送小字节请求，验证 `206 Partial Content` 与有效的 `Content-Range`。
4. 向浏览器代码暴露 `Accept-Ranges`、`Content-Length` 与 `Content-Range`。
5. 检查签名 URL 是否过期，或 CDN 是否移除了 `Range` 头。

示例头见 [CORS 与 HTTP Range](./cors)。

## 归档类型被拒绝

公开归档工厂接受 ZIP、TAR 与 TAR.GZ 文件。对于远程源，请使用允许识别归档种类的 URL 与响应。使用 `onFatalError` 区分 `UNSUPPORTED_ARCHIVE` 与网络及数据集失败。

## 数据集打开但带警告

仅精确声明的版本 `v2.1` 与 `v3.0` 为 1.0 目标支持范围。任何其他或缺失的 `codebase_version` 均为未知。在安全时可能仍以带警告的只读模式提供检查，但导出须保持禁用。

## 视频不可用

播放取决于浏览器与数据集使用的编解码器。在目标浏览器中测试相同资源并检查媒体错误。查看器冒烟测试并不建立对每个编解码器的支持。在安全时非媒体数据仍应可检查。

## Next.js 在服务端渲染时失败

从 Client Component 渲染查看器，并用 `ssr: false` 动态加载。包仅适用于浏览器，不支持 React Server Components 或服务端渲染。见 [快速开始](./quick-start)。

## 自定义数据源泄漏内存

在 `invalidateObjectUrl()` 或 `clear()` 中撤销生成的 object URL，释放归档句柄，并确保重复读取不会在无界缓存中保留完整 buffer。自定义 [`DataSource`](./api) 的生命周期由宿主拥有。
