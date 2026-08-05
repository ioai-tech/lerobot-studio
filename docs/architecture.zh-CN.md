# 架构

> **Language / 语言：** [English](/architecture) | [简体中文](./architecture)

项目包含一个 npm 包和一个独立 SPA。源码目录用于分层，并不是分别发布的包。

```
src/core       纯 TypeScript 领域逻辑
src/platform   浏览器、WASM、Worker、File System Access
src/ui         共享 UI / 主题
src/react      对外 React 入口
src/web        SPA 外壳（不发到 npm）
```

---

## 依赖方向

```
src/web → src/react → src/platform → src/core
                 ↘ src/ui ↗
```

- `core` 包含领域逻辑，不依赖 React 或浏览器 UI。
- `platform` 包含浏览器、WASM、Worker 和文件系统集成，不依赖 React UI。
- `react` 是公开 API，可使用 `platform`、`core` 和 `ui`。
- `web` 是独立应用，不从 npm 包导出。

---

## 构建

- `npm run build` → `dist/`（静态站 / Workers 资源）
- `npm run build:lib` → `dist-lib/`（给 `@ioai/lerobot-studio`；CSS 挂在 `.lerobot-root` 下）

公开入口：`src/react/index.ts` + `@ioai/lerobot-studio/style.css`。

npm 包面向 React `^19.0.0` 的 ESM 浏览器应用，支持查看和会话内的 Episode 修改；导出引擎由独立应用提供。版本约定见 [弃用策略](./deprecation)。

---

## 信任边界

- 数据集字节和路径会作为不可信输入处理；加载失败不会改动源文件。
- 只有 `v2` 和 `v3` 系列中较新的 minor 版本会使用只读适配器；其他版本会被拒绝。
- 远程 URL 会经过网络；CORS、范围请求支持和认证由宿主配置。
- 浏览器存储是可选的，见 [隐私](./privacy)。
- npm 包不包含遥测功能。

见 [兼容性](./compatibility)。
