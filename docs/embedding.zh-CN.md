# 将 LeRobot Studio 嵌入 React

> **Language / 语言：** [English](/embedding) | [简体中文](./embedding)

当你需要在自己的 React 应用中展示 LeRobot 数据集时，可以使用 `@ioai/lerobot-studio`。该包提供查看器；认证、远程链接和导出操作仍由你的应用负责。

## 环境要求

- React 和 React DOM `^19.0.0`
- 支持 ES 模块和 Web Worker 的浏览器构建环境
- 仅支持客户端渲染；不支持 SSR、React Server Components、CommonJS 和 Node.js

## 安装

安装已发布的包：

```bash
npm install @ioai/lerobot-studio
```

## 引入样式

在应用入口引入一次样式：

```tsx
import '@ioai/lerobot-studio/style.css';
```

查看器样式会限制在 `.lerobot-root` 下，尽量避免影响页面其他部分。

## 展示远程压缩包

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function DatasetViewer() {
  return (
    <div style={{ height: 720, minHeight: 480 }}>
      <LeRobotViewer
        dataSource="https://datasets.example.com/pick-place.zip"
        theme="system"
        language="en"
      />
    </div>
  );
}
```

外层容器需要有明确高度。查看器会填满父元素，不会自行决定页面高度。

归档服务器必须允许你的应用从浏览器请求文件。相关响应头见 [CORS 与 HTTP Range](./cors)。

## 使用本地压缩包

通过自己的 UI 选择 `File` 后，使用公开辅助函数：

```tsx
import { createArchiveDataSourceFromFile, LeRobotViewer } from '@ioai/lerobot-studio';

export function LocalDatasetViewer({ file }: { file: File }) {
  const dataSource = createArchiveDataSourceFromFile(file);

  return (
    <div style={{ height: 720 }}>
      <LeRobotViewer dataSource={dataSource} />
    </div>
  );
}
```

这个辅助函数不会弹出系统文件选择框。在你自己的界面里选好文件后再传入。如果要在自定义欢迎页上提供目录或压缩包入口，见下文「自定义欢迎页」。

## 展示远程文件清单

当宿主已经为单个数据集文件签好名、且不能整包下载归档时，使用这个辅助函数。`getObjectUrl` 会直接返回远程 URL，浏览器可以通过 Range 请求流式播放媒体。

```tsx
import {
  createRemoteManifestDataSource,
  LeRobotViewer,
  type RemoteFileEntry,
} from '@ioai/lerobot-studio';

export function SignedManifestViewer({ files }: { files: RemoteFileEntry[] }) {
  const dataSource = createRemoteManifestDataSource(files);

  return (
    <div style={{ height: 720 }}>
      <LeRobotViewer dataSource={dataSource} theme="system" />
    </div>
  );
}
```

每条记录需要逻辑路径和 HTTP(S) URL。可选的 `contentType` 与 `sizeBytes` 会帮助查看器和内置安全限额。

## 自定义欢迎页

多数嵌入场景会先让用户选数据，再打开查看器。用 `LeRobotStudioProvider` 包一层，欢迎页和查看器就能共用主题、语言和样式。有了 `DataSource` 之后，再渲染 `LeRobotViewerContent`：

```tsx
import { useState } from 'react';
import {
  DatasetSourceSelector,
  LeRobotStudioProvider,
  LeRobotViewerContent,
  createArchiveDataSourceFromFile,
  createDirectoryDataSource,
  useDragAndDrop,
  type DataSource,
} from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

export function CustomWelcome({ language }: { language: string }) {
  const [dataSource, setDataSource] = useState<DataSource | string | null>(null);
  useDragAndDrop({
    onFile: (file) => setDataSource(createArchiveDataSourceFromFile(file)),
    onDirectoryHandle: (handle) => setDataSource(createDirectoryDataSource(handle)),
  });

  return (
    <LeRobotStudioProvider theme="system" language={language}>
      {dataSource ? (
        <div style={{ height: 720 }}>
          <LeRobotViewerContent dataSource={dataSource} showSidebar showPlaybackBar />
        </div>
      ) : (
        <DatasetSourceSelector
          onOpenDirectory={async () => {
            const handle = await window.showDirectoryPicker();
            setDataSource(createDirectoryDataSource(handle));
          }}
          onOpenLocalArchive={() => {
            /* 你的 file input → createArchiveDataSourceFromFile */
          }}
          onOpenRemoteArchive={(url) => url && setDataSource(url)}
        />
      )}
    </LeRobotStudioProvider>
  );
}
```

如果要显示导出按钮，自己接 `onExport`。本包不包含独立应用里的导出对话框。

## Next.js

在 Client Component 中加载查看器，并关闭 SSR：

```tsx
'use client';

import dynamic from 'next/dynamic';

const LeRobotViewer = dynamic(
  () => import('@ioai/lerobot-studio').then((module) => module.LeRobotViewer),
  { ssr: false },
);
```

## 自定义行为

常用属性：

| 属性                      | 作用                                            |
| ------------------------- | ----------------------------------------------- |
| `dataSource`              | 远程归档 URL、远程文件清单或自定义 `DataSource` |
| `theme`                   | `light`、`dark` 或 `system`                     |
| `language`                | `en`、`zh` 或 `ja`                              |
| `showSidebar`             | 显示或隐藏 Episode 侧栏                         |
| `showPlaybackBar`         | 显示或隐藏播放控制栏                            |
| `enableKeyboardShortcuts` | 启用或关闭查看器快捷键                          |
| `onFatalError`            | 接收加载失败信息，并自行显示错误状态            |
| `onExport`                | 用户点击宿主导出按钮时的回调                    |

`onExport` 只是回调，不包含独立应用中的导出引擎。

提供 `onFatalError` 后，查看器不会渲染内置的致命错误状态。请在应用中保存错误信息，并自行显示合适的提示。

自定义 `DataSource` 和完整类型列表见 [API 参考](./api)。

## 集成注意事项

- 为查看器的父元素设置明确高度。
- 使用远程压缩包时，请检查 CORS 和 HTTP Range 响应头。
- 在 Next.js 中，请将查看器置于 Client Component，并使用 `ssr: false`。
- 需要编辑或内置导出时，请使用独立应用。欢迎页组件只负责选数据和构造本地 `DataSource`。
