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

### 刷新会过期的 URL

签名 URL 会过期。传入 `refresh` 后，查看器会重新签名，而不是直接失败：

```tsx
const dataSource = createRemoteManifestDataSource(files, {
  // 返回同样的逻辑路径、新的 URL 及其过期时间。
  refresh: async () => {
    const signed = await fetchSignedManifest(datasetId);
    return { files: signed.files, expiresAt: signed.expiresAt };
  },
  // 初始 `files` 中没有自己 `expiresAt` 的条目的过期时间（ISO 8601）。
  expiresAt: manifestExpiresAt,
});
```

- 遇到 401 或 403，或者 URL 距过期不足 60 秒时，调用一次 `refresh`；同时发生的失败共用这一次调用。URL 早于某次已完成刷新的读取，会直接用新 URL 重试。
- 刷新会替换过期时间。每个刷新后的条目按自己的 `expiresAt` 过期，否则按随文件一起返回的 `expiresAt`，否则视为未知；此时只有 401 或 403 才会触发下一次刷新。`refresh` 也可以只返回条目数组。
- 因临近过期触发的刷新每 30 秒最多一次。后台刷新失败，或返回的 URL 仍在 60 秒内过期时，下次等待时间逐次加倍（从 5 秒到最多 5 分钟）。
- 新 URL 按路径替换旧 URL，失败的读取重试一次。正在播放的视频在同一时间点切换到新 URL，播放或暂停状态保持不变。
- 重试仍然失败时，读取以 `RemoteSourceError` 失败（`code` 为 `HTTP_STATUS`、`NETWORK` 或 `REFRESH_FAILED`，并带有 `path` 和 `status`）。
- 不传 `refresh` 时，失败的读取不会重试。

### 只显示部分 episode

`episodeScope` 把数据集限制在一组 `episode_index` 上，v2.1 和 v3.0 都支持：

```tsx
createRemoteManifestDataSource(files, { episodeScope: [3, 4, 9] });
```

只会列出和读取这些 episode，所以清单只需包含它们的文件。健康报告把其他 episode 标为**未评估**（`EPISODES_OUT_OF_SCOPE`），不会报告为缺失。

## 展示多个录制中的 episode

`createEpisodeSetDataSource` 把多个单 episode 的 LeRobot v3 录制显示成一个数据集。每个 episode 是某个录制中的一段行区间。打开时不会签名任何文件：

```tsx
import { createEpisodeSetDataSource, LeRobotViewer } from '@ioai/lerobot-studio';

const dataSource = createEpisodeSetDataSource(
  {
    fps: 30,
    features, // 各录制共用的 info.json features
    recordings: recordingIds.map((id) => ({ id })),
    episodes: [
      {
        recordingId: 'r7',
        task: 'pick cube',
        fromRow: 300,
        toRow: 600,
        fromS: 10,
        toS: 20,
        meta: { split: 'train' },
      },
      // ...
    ],
  },
  {
    // 为最多 50 个录制签名文件：[{ id, files: RemoteFileEntry[] }]。
    resolve: (ids) => signRecordings(ids),
  },
);

<LeRobotViewer dataSource={dataSource} />;
```

- 打开数据集时不调用任何函数。第一次读取某个录制时才解析它，并顺带解析正在打开的 episode 之后两个 episode 的录制。这次调用失败时，会单独解析所选录制，预取失败不会妨碍正在打开的 episode。
- URL 刷新只重新签名已经解析过的录制（`refresh`，默认等于 `resolve`）。
- 每个录制必须只有一个 episode：一个数据 parquet，每个相机一个 MP4。其他布局以 `EpisodeSetError`（`RECORDING_LAYOUT_REFUSED`）失败。`resolve` 失败时，该录制得到 `RECORDING_RESOLVE_FAILED`，其他 episode 仍可播放。
- 行号不必从 0 开始。`meta` 中的值会成为额外的 episode 列。
- `previewVideoPath`（例如 `'videos/{video_key}/preview.mp4'`）在录制提供较轻的副本时，用它播放每个相机。

## 绘制额外的时间序列

`auxiliarySeries` 从单独的 parquet 文件加入时间序列，例如 200 Hz 的 IMU 或其他程序的输出。它们作为额外的图表组，与数据集共用同一条播放线：

```tsx
<LeRobotViewer
  dataSource={dataSource}
  auxiliarySeries={[
    {
      id: 'imu',
      label: 'Head IMU',
      files: [{ logicalPath: 'imu.parquet', presignedUrl: imuUrl }],
      timeColumn: 'timestamp_ns',
      timeUnit: 'ns', // 's'、'ns' 或 'frame'
      timeOffsetNs: '-1763000000123456789', // 可选；把绝对时间换成相对 episode 起点的时间
      columns: ['gyro_x', 'gyro_y', 'gyro_z'], // 可选；默认所有数值列
      episodeIndex: 0, // 可选；默认所有 episode
    },
  ]}
  onAuxiliarySeriesWarning={(warning) => console.warn(warning.code, warning.message)}
/>
```

- 采样保持原有频率，不会重采样到视频帧率。图表按每像素最小值/最大值抽取绘制全部采样，原始数据面板显示离播放线最近的采样。
- 时间换算为相对 episode 起点的秒数。所有单位都会加上 `timeOffsetNs`；`ns` 时精确相加（字符串，因此 int64 时间戳不丢精度）。`frame` 除以数据集的 fps。
- parquet 时间戳列（例如 pandas 的 `datetime64[ns]`）按纳秒精确读取，需要 `timeUnit: 'ns'`；其他单位给出 `TIME_UNIT_MISMATCH`。
- 缺少的列会产生警告（`COLUMN_MISSING`，另有 `TIME_COLUMN_MISSING`、`TIME_UNIT_MISMATCH`、`READ_FAILED`），每个只报告一次，其他序列照常绘制。只在部分文件中缺少的列，在这些文件的采样处留空。
- 用新 URL（同样的 `logicalPath`）再次传入同一序列时，只替换 URL，已加载的数据不会重新读取。
- 额外序列只用于单个数据集的视图。在 episode 集合上会被忽略，并给出 `EPISODE_SET_UNSUPPORTED`。

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

| 属性                       | 作用                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `dataSource`               | 远程归档 URL、远程文件清单或自定义 `DataSource`                   |
| `theme`                    | `light`、`dark` 或 `system`                                       |
| `language`                 | `en`、`zh` 或 `ja`                                                |
| `showSidebar`              | 显示或隐藏 Episode 侧栏                                           |
| `showPlaybackBar`          | 显示或隐藏播放控制栏                                              |
| `enableKeyboardShortcuts`  | 启用或关闭查看器快捷键                                            |
| `onFatalError`             | 接收加载失败信息，并自行显示错误状态                              |
| `onExport`                 | 用户点击宿主导出按钮时的回调                                      |
| `auxiliarySeries`          | 要绘制的额外时间序列，见[绘制额外的时间序列](#绘制额外的时间序列) |
| `onAuxiliarySeriesWarning` | 接收额外序列的警告                                                |
| `annotation`               | 由宿主控制的分段：`value`、`onChange`、`saveState`                |
| `readOnly`                 | 只显示分段和审核，不显示任何编辑控件                              |
| `fields`                   | 每个分段上可设置的值（`select`、`tags`、`text`）                  |
| `messages`                 | 按键替换内置的分段文案                                            |

`onExport` 只是回调，不包含独立应用中的导出引擎。

提供 `onFatalError` 后，查看器不会渲染内置的致命错误状态。请在应用中保存错误信息，并自行显示合适的提示。

分段、审核与修改操作见 [API — 分段与审核](./api#segments-and-review)。自定义 `DataSource` 和完整类型列表见 [API 参考](./api)。

## 集成注意事项

- 为查看器的父元素设置明确高度。
- 查看器的根元素是带标签的 `region` 地标（不是 `main`），可以放在宿主页面自己的 `main` 里。
- 加载前会检查每个相机声明的编码（`info.features[key].info["video.codec"]`）。浏览器无法解码时，该相机显示注明编码的提示，而不是一个坏掉的播放器。
- 使用远程压缩包时，请检查 CORS 和 HTTP Range 响应头。
- 在 Next.js 中，请将查看器置于 Client Component，并使用 `ssr: false`。
- 需要编辑或内置导出时，请使用独立应用。欢迎页组件只负责选数据和构造本地 `DataSource`。
