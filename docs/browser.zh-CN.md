# 浏览器支持

> **Language / 语言：** [English](/browser) | [简体中文](./browser)

建议使用当前版本的 Chrome、Edge、Firefox 或 Safari；视频编解码器支持因浏览器而异。

---

## 测试范围

Chromium 运行完整的浏览器测试套件。Firefox 和 WebKit 运行冒烟测试，覆盖查看器界面、错误处理、基础无障碍、只读版本处理以及远程和自定义数据源。

| 能力                      | Chromium                 | Firefox / WebKit           |
| ------------------------- | ------------------------ | -------------------------- |
| 查看器和错误处理          | 完整测试                 | 冒烟测试                   |
| 远程或自定义 `DataSource` | 支持                     | 冒烟测试                   |
| 本地归档                  | 支持                     | 支持，播放取决于编解码器   |
| 本地文件夹导入            | 拖放、选择器和可恢复句柄 | 拖放和选择器；无法恢复句柄 |
| 可恢复文件夹句柄          | File System Access       | 不支持                     |
| 目录导出                  | 仅 Chromium              | 不支持                     |
| 视频编码和导出            | WebCodecs 测试套件       | 仅能力检测                 |
| 视频播放                  | 取决于编解码器           | 取决于编解码器             |

---

## 仅客户端渲染

请在浏览器中渲染。不支持 SSR、RSC、Node.js 或 CommonJS。

缺少 File System Access 或 WebCodecs 时，对应功能会被禁用；其余可用面板仍可正常显示。不支持的媒体应显示明确错误，而不会影响整个界面。

File System Access 需要[安全上下文](https://developer.mozilla.org/zh-CN/docs/Web/Security/Secure_Contexts)（`https:` 或 `http://localhost` / `http://127.0.0.1`）。在 `http://192.168.x.x` 这类明文 HTTP 局域网源上，Chrome 仍会暴露该 API，但一调用就会终止标签页。Studio 在这种源上不会调用这些 API，而是回退到 `<input type="file" webkitdirectory>` 与 `webkitGetAsEntry`。

另见 [兼容性](./compatibility)。
