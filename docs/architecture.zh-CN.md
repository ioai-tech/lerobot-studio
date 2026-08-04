# 架构

> **Language / 语言：** [English](./architecture.md) | [简体中文](./architecture.zh-CN.md)

LeRobot Studio 是单个 npm 包与客户端渲染 SPA 仓库。目录边界是架构划分，而非分别发布的包。

```
src/core       纯 TypeScript 领域逻辑
src/platform   浏览器、WASM、Worker 与 File System Access 适配器
src/ui         shadcn Base UI 基元与主题 token
src/react      公开可嵌入 React 库 API
src/web        SPA 外壳、URL 状态与仅部署用的组合根
```

## 依赖规则

```
src/web → src/react → src/platform → src/core
                 ↘ src/ui ↗
```

- `core` 不得导入 React、DOM、浏览器 API 或上层模块。
- `platform` 不得导入 React UI。
- `react` 暴露库 API，可消费 platform、core 与 UI 模块。
- `web` 不从 npm 导出；它是独立应用的组合根。

## 构建目标

- `npm run build` 生成 Cloudflare Workers 静态资源目录 `dist/`。
- `npm run build:lib` 生成 `@ioai/lerobot-studio` 消费者的 `dist-lib/`。库构建在 `.lerobot-root` 下作用域化 CSS，防止泄漏到宿主页面。

## 公开 API

可发布表面为 `src/react/index.ts`。样式通过 `@ioai/lerobot-studio/style.css` 暴露。

稳定 1.0 包契约为仅查看、仅 ESM、仅浏览器、仅 CSR，React 与 React DOM `^19.0.0`。“仅查看”指数据集查看是唯一稳定的库工作流；源数据修改、编辑、导出服务与独立应用控件不是稳定公开 API。超出该边界的任何导出须保持内部，或在 1.0 前明确分类。

公开 API 在 major 1 内按 [弃用策略](./deprecation) 保持向后兼容。

## 信任边界

- 数据集解析、校验、媒体处理与导出处理不可信输入，且必须在不修改源数据的情况下失败。
- 未知数据集版本不得静默选择版本适配器。1.0 行为是在安全时提供带警告的只读检查，并禁用导出。
- 远程源跨越外部网络边界；CORS、Range、认证、可用性与远程日志由宿主与源服务器控制。
- 浏览器存储是可选且容错的。见 [隐私](./privacy)。
- npm 库为零遥测契约。

这些信任边界保证包含在 [兼容性](./compatibility) 中跟踪的 1.0 发布门禁；核心路径已在自动化 CI 中验证，最终人工发布门禁仍待完成。
