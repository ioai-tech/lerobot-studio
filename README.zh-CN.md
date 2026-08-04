# LeRobot Studio

> **Language / 语言：** [English](./README.md) | [简体中文](./README.zh-CN.md)

基于浏览器的 [LeRobot](https://github.com/huggingface/lerobot) 数据集查看器，由 [IO-AI.TECH](https://io-ai.tech) 维护。

在线演示：[https://lerobot.studio](https://lerobot.studio)

本仓库正在准备稳定的 `1.0.0` 契约。查看（viewing）是唯一稳定的公开库工作流：包不会修改源数据集，也不暴露编辑器 API。独立应用中的导出不属于稳定库 API，在官方 LeRobot 训练流程验证其输出可直接消费之前，导出仍是一项 **1.0 发布门禁**。

- 打开本地文件夹、本地归档或远程归档
- 检查同步的视频、图表与原始特征
- 通过 `@ioai/lerobot-studio` 嵌入纯客户端 React 查看器
- 在浏览器本地处理数据集内容

## 开源

LeRobot Studio 正在准备于 `github.com/ioai-tech/lerobot-studio` 进行公开开发。该公开仓库及其 Issue 跟踪器是 GitHub 迁移计划的一部分，可能尚未可用。

- 公开后，请通过仓库的 GitHub Issues 报告可复现缺陷或提出改进建议。
- 提交 Pull Request 前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.zh-CN.md)。
- 在所有社区空间中遵守 [行为准则](./CODE_OF_CONDUCT.zh-CN.md)。
- 安全漏洞仅通过 [SECURITY.md](./SECURITY.zh-CN.md) 中的私有流程报告。

## 快速开始

```bash
npm ci
npm run fixtures:generate
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

Docker：

```bash
docker build -t lerobot-studio .
docker run --rm -p 8080:8080 lerobot-studio
```

然后打开 [http://localhost:8080](http://localhost:8080)。生产托管见 [部署](./docs/deployment.zh-CN.md)。

## 仓库结构

```
src/core                 领域逻辑（无 React）
src/platform             浏览器/WASM 适配器与 Worker
src/ui                   共享 UI 基元
src/react                已发布的 React 库 API
src/web                  独立 Web 应用外壳
tests/                   单元测试 + 浏览器测试
docs/                    架构与运维文档
```

## 库用法

`1.0.0` 包发布后：

```bash
npm install @ioai/lerobot-studio
```

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function App() {
  return (
    <div style={{ height: '720px', minHeight: '480px' }}>
      <LeRobotViewer dataSource="https://example.com/dataset.zip" />
    </div>
  );
}
```

宿主必须为查看器提供明确高度；组件会填满容器，不会自行决定页面高度。`1.0.0` 兼容性契约为 React 与 React DOM `^19.0.0`、仅 ESM、仅浏览器、仅 CSR。Vite 与 Next.js 纯客户端消费者验证仍是 1.0 发布门禁。

### Vite

在客户端代码中正常导入并渲染组件。不要在浏览器构建中将其 CSS、Worker 或 WASM 资源外部化。

### Next.js

从 Client Component 加载查看器，并禁用 SSR：

```tsx
'use client';

import dynamic from 'next/dynamic';

const Viewer = dynamic(
  () => import('@ioai/lerobot-studio').then((module) => module.LeRobotViewer),
  { ssr: false },
);
```

LeRobot Studio 不支持 React Server Components、服务端渲染、CommonJS 或在 Node.js 中执行。

## 兼容性契约

- 稳定线：`1.0.0`；在 major 1 内，minor 与 patch 保持向后兼容，受 [弃用策略](./docs/deprecation.zh-CN.md) 约束。
- 1.0 精确数据集支持目标为 LeRobot `v2.1` 与 `v3.0`。前缀兼容变体如 `v2.0`、`v2.x` 或 `v3.x` 不在覆盖范围内。精确版本的打开与检查行为**已在自动化 CI 中验证**；`1.0.0` 的最终人工发布门禁仍待完成。
- 未知版本在可安全解析时以带警告的只读模式打开，且导出禁用。该行为已在自动化 CI 与浏览器套件中验证；`1.0.0` 的最终人工发布门禁仍待完成。
- 受支持版本的导出已在 CI 中对照官方 LeRobot reader 验证，但在维护者完成最终人工发布门禁之前，不得宣称为普遍受支持。任何“尽力而为”的导出均不视为受支持。
- npm 库为零遥测契约：不得发送分析、诊断、数据集元数据、文件名或使用事件。

浏览器、数据集、网络与能力矩阵见 [兼容性与发布门禁](./docs/compatibility.zh-CN.md)。

## 文档

- [快速开始](./docs/quick-start.zh-CN.md)
- [稳定 API](./docs/api.zh-CN.md)
- [数据格式](./docs/data-formats.zh-CN.md)
- [CORS 与 HTTP Range](./docs/cors.zh-CN.md)
- [浏览器支持](./docs/browser.zh-CN.md)
- [故障排查](./docs/troubleshooting.zh-CN.md)
- [迁移](./docs/migration.zh-CN.md)
- [架构](./docs/architecture.zh-CN.md)
- [兼容性与发布门禁](./docs/compatibility.zh-CN.md)
- [开发](./docs/development.zh-CN.md)
- [部署](./docs/deployment.zh-CN.md)
- [隐私](./docs/privacy.zh-CN.md)
- [弃用策略](./docs/deprecation.zh-CN.md)
- [GitHub 迁移清单](./docs/github-migration.zh-CN.md)
- [贡献指南](./CONTRIBUTING.zh-CN.md)
- [治理](./GOVERNANCE.zh-CN.md)
- [支持](./SUPPORT.zh-CN.md)
- [安全](./SECURITY.zh-CN.md)
- [第三方声明](./NOTICE)

## 部署

公开站点为 [https://lerobot.studio](https://lerobot.studio)。将迁移后的 GitHub `main` 分支接入 Cloudflare Workers Builds 是计划中的生产路径，须在迁移期间验证。见 [部署](./docs/deployment.zh-CN.md)。

## 隐私

npm 库为零遥测契约。应用使用浏览器存储保存偏好、最近来源元数据，以及在浏览器允许时保存本地文件句柄。除非用户打开远程 URL，数据集字节均在本地处理。见 [隐私](./docs/privacy.zh-CN.md)。

## 许可证

[MIT](./LICENSE) — Copyright (c) 2026 IO-AI.TECH
