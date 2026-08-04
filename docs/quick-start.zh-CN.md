# 快速开始

> **Language / 语言：** [English](./quick-start.md) | [简体中文](./quick-start.zh-CN.md)

LeRobot Studio 有两个入口：

- 托管应用 [lerobot.studio](https://lerobot.studio)；以及
- 浏览器专用 React 包（`@ioai/lerobot-studio` 发布后）。

## 使用托管查看器

打开在线应用，选择本地文件夹、本地归档或远程归档。本地内容在浏览器中处理。远程归档须满足 [CORS 与 HTTP Range 要求](./cors) 中的约定。

## 嵌入 React 查看器

::: warning 发布状态
`@ioai/lerobot-studio@1.0.0` 尚未发布。安装与下方稳定契约仅在 [1.0 发布门禁](./compatibility#_1-0-acceptance-gates) 通过后可用。
:::

```bash
npm install @ioai/lerobot-studio
```

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function DatasetViewer() {
  return (
    <div style={{ height: 720, minHeight: 480 }}>
      <LeRobotViewer dataSource="https://example.com/dataset.zip" />
    </div>
  );
}
```

宿主必须为查看器提供明确高度。组件会填满容器，不会自行决定页面高度。

## 运行时契约

- React 与 React DOM `^19.0.0`
- 仅 ESM
- 仅浏览器与客户端渲染
- 不支持 Node.js、CommonJS、React Server Components、SSR 或 hydration

在 Next.js 中，从 Client Component 加载查看器并禁用 SSR：

```tsx
'use client';

import dynamic from 'next/dynamic';

const Viewer = dynamic(
  () => import('@ioai/lerobot-studio').then((module) => module.LeRobotViewer),
  { ssr: false },
);
```

自定义数据源、回调与错误处理见 [稳定 API](./api)。

## 开发本仓库

```bash
npm ci
npm run fixtures:generate
npm run dev
```

开发本文档站点：

```bash
npm run docs:dev
```
