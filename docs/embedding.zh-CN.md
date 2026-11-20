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

### 图表只读取要显示的内容

一个 episode 的图表只需要它的数值列，而不是整个数据文件。查看器用 HTTP Range 请求读取 parquet 数据文件：

- 先读文件尾（最后 64 KB），再只读取包含该 episode 的行组中所选列的列块，相邻的列块合并为一次请求。切换到同一文件中的其他 episode 时，复用已读取的字节。
- 时间轴和最上面的图表组先到，其余组随后：每个图表在自己的列到达后立即绘制，仍在加载的组显示占位（`aria-busy`）。原始数据面板需要的其他列在图表之后读取。
- 有 `sizeBytes` 时，请求是普通的 `bytes=a-b` 范围，属于 CORS 安全请求头（不触发预检）。没有它时，文件尾请求是后缀范围，大小取自 `Content-Range`，跨域服务器必须暴露该响应头（`Access-Control-Expose-Headers: Content-Range`）。
- 服务器忽略 `Range`（返回 `200`）时，代价是下载一次整个文件，所有列都复用它；查看器记录一次 `RANGE_UNSUPPORTED`，此后整文件读取该数据源的文件。`RANGE_SIZE_UNKNOWN`（大小未知）和不是 parquet 的文件同样按名称回退。
- 同一文件的多次读取，只有在报告相同大小、且（服务器暴露时）相同 `ETag`（`Access-Control-Expose-Headers: ETag`）时才会合并。文件发生变化时，查看器从新的文件尾重新打开一次；若再次变化，则整文件读取（`FILE_CHANGED`）。
- 不可信的文件尾（范围超出数据区、列表元素数超过剩余字节、文件尾超过 64 MiB）在用于任何读取之前就被拒绝，该文件整文件读取（`FOOTER_INVALID`）。
- 每种回退原因在一个查看器中只记录一次。

第一个图表在首个视频帧之后很快绘制；其余图表受其字节在链路上的到达速度限制，该链路与相机共享。

行组是最小单位：写入方把许多 episode 放进同一个行组时（pyarrow 对小文件的默认做法），读取一个 episode 的列仍要读取整个行组的这些列。

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
- 重试仍然失败时，读取以 `RemoteSourceError` 失败（`code` 为 `HTTP_STATUS`、`NETWORK` 或 `REFRESH_FAILED`，并带有 `path` 和 `status`）。范围读取在刷新后保持原来的范围。
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

`auxiliarySeries` 从单独的 parquet 文件加入时间序列，例如 200 Hz 的 IMU 或其他程序的输出。它们作为额外的图表组，与数据集共用同一条播放线。它们在该 episode 的图表之后读取，不会拖慢图表：

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
- `timeColumn: null` 搭配 `timeUnit: 'frame'` 表示行号就是时间：第 `i` 行（按 `files` 的顺序连续计数）对应第 `i` 帧。适用于没有时间列的逐帧输出，所有数值列都会绘制。`null` 搭配其他单位会在读取任何内容之前被拒绝，给出 `ROW_TIME_NEEDS_FRAME_UNIT`。
- 缺少的列会产生警告（`COLUMN_MISSING`，另有 `TIME_COLUMN_MISSING`、`TIME_UNIT_MISMATCH`、`ROW_TIME_NEEDS_FRAME_UNIT`、`READ_FAILED`），每个只报告一次，其他序列照常绘制。只在部分文件中缺少的列，在这些文件的采样处留空。
- 用新 URL（同样的 `logicalPath`）再次传入同一序列时，只替换 URL，已加载的数据不会重新读取。
- 额外序列只用于单个数据集的视图。在 episode 集合上会被忽略，并给出 `EPISODE_SET_UNSUPPORTED`。

## 构建完整的宿主 {#build-a-complete-host}

下面的宿主编辑一个录制的分段，显示检查结果和另一个程序的建议，加入自己的操作，在 URL 中跟随选择，并匹配自己的配色。所有内容都以数据和回调传入：

```tsx
import { useMemo, useState } from 'react';
import {
  LeRobotViewer,
  createEpisodeSetDataSource,
  createRemoteManifestDataSource,
  type AnnotationField,
  type LeRobotExtension,
  type TimelineMarker,
} from '@ioai/lerobot-studio';

const fields: AnnotationField[] = [
  {
    id: 'outcome',
    label: '结果',
    kind: 'select',
    options: [
      { value: 'success', label: '成功', key: '1' },
      { value: 'failure', label: '失败', key: '2' },
    ],
  },
  { id: 'tags', label: '标签', kind: 'tags' },
];

export function RecordingStudio({ view, url, navigate }: HostProps) {
  // 一个录制（签名文件会刷新），或一组冻结的 episode（按需签名）。
  const dataSource = useMemo(
    () =>
      view.kind === 'episodeSet'
        ? createEpisodeSetDataSource(view.manifest, { resolve: (ids) => signRecordings(ids) })
        : createRemoteManifestDataSource(view.files, {
            refresh: () => fetchSignedFiles(view.id),
            expiresAt: view.expiresAt,
          }),
    [view],
  );
  const { value, saveState, onChange } = useEpisodeDocument(view.id); // 宿主自己的存储
  const [rendition, setRendition] = useState<'original' | 'anonymized'>('original');

  // 标记：label 是显示文本，请先把检查 id 本地化。
  const markers: TimelineMarker[] = view.checks.map((check) => ({
    id: check.id,
    episodeIndex: 0,
    startFrame: check.startFrame,
    endFrame: check.endFrame,
    severity: check.severity, // 'info' | 'warn' | 'fail'
    label: t(`checks.${check.checkId}`),
    checkId: check.checkId,
  }));

  const extensions: LeRobotExtension[] = [
    {
      id: 'host',
      toolbar: [
        {
          kind: 'button',
          id: 'propose',
          label: t('propose'),
          icon: 'sparkles',
          variant: 'primary',
          onSelect: startProposals,
          disabled: proposalsRunning,
          disabledReason: t('proposalsRunning'),
        },
        {
          kind: 'toggle',
          id: 'rendition',
          label: t('frames'),
          options: [
            { value: 'original', label: t('original') },
            { value: 'anonymized', label: t('anonymized') },
          ],
          value: rendition,
          onChange: (next) => setRendition(next as typeof rendition),
        },
      ],
      notices: proposalsRunning
        ? [{ id: 'proposals', severity: 'info', text: t('proposing'), progress: 'indeterminate' }]
        : [],
    },
  ];

  return (
    <div style={{ height: '100%' }}>
      <LeRobotViewer
        dataSource={dataSource}
        language={locale} // BCP 47：'zh-CN'、'zh'、'en' 等；未知标签回退到英文
        theme={colorScheme}
        themeTokens={{ primary: brand, primaryForeground: '#fff', radius: '0.5rem' }}
        annotation={{ value, onChange, saveState, createSegmentId: uuidv7 }}
        fields={fields}
        messages={{ 'segments.title': '片段', 'overlay.legend': '正在生成的建议' }}
        markers={markers}
        overlaySegments={[{ episodeIndex: 0, segments: view.proposals }]}
        extensions={extensions}
        auxiliarySeries={view.imu ? [view.imu] : undefined}
        initialSelection={{ segmentId: url.episode, timeS: url.t }}
        onSelectionChange={({ segmentId, timeS }) =>
          navigate({ episode: segmentId, t: timeS.toFixed(2) }, { replace: true })
        }
      />
    </div>
  );
}
```

切换 `rendition` 会传入帧相同的另一个 `dataSource`；查看器保留所在的 episode、分段和时间（见[选择与深层链接](#selection-and-deep-links)）。

嵌入的查看器能显示的每一条文案都可以替换，不只是分段文案。范围包括分段列表、侧栏、面板、图表、播放、导出、批量裁剪、健康检查、对话框和错误提示。`LEROBOT_MESSAGE_KEYS` 列出所有键，TypeScript 类型 `LeRobotMessageKey` 会检查键名。英文目录 `src/react/locales/en.json` 给出每个键的默认文案。只有独立应用自己才显示的文案不是宿主可用的键：它的页面元数据，以及打开或恢复本地文件夹的提示。

`messages` 的值是 ICU 消息字符串（也支持 `{{name}}` 占位符）。对于未知的键，或值不是字符串（例如预编译的消息数组）的键，查看器保留内置文案，并为每个键输出一条 `console.warn`，例如 `lerobot-studio: messages["segments.row"] ignored: expected an ICU string, got array`。

### 标记与只读建议 {#markers-and-read-only-suggestions}

- **`markers`** 是时间轴上的区间（或单帧刻度），按 `severity` 着色，`label` 显示在提示框和无障碍名称中。点击标记跳到它的第一帧；标记行只占一个 Tab 停靠点，用方向键在标记间移动。与 `warn` 或 `fail` 标记重叠的分段会进入 **有问题** 筛选并显示问题数。`checkId` 留给宿主使用，不会显示。
- **`overlaySegments`** 是只读分段（例如另一个程序的建议），显示在分段轨道上方的细条中。细条的图例是 `overlay.legend` 文案（默认“建议（只读）”）。点击其中一段会跳到该段；细条中的内容都不能编辑。

### 工具栏与通知 {#toolbar-and-notices}

`extensions` 以查看器自己的样式、焦点顺序、主题和窄屏布局加入宿主控件。它们是声明式的：查看器从不渲染宿主的 React 元素。

- `toolbar` 项：`button`（`icon` 为 `sparkles`、`refresh`、`external`、`download` 或 `none`；`variant` 为 `primary` 或 `default`；`busy` 显示加载图标并忽略点击）、`toggle`（分段切换，对辅助技术呈现为单选组）和 `link`（`external` 在新标签页打开）。
- 带 `disabledReason` 的禁用按钮仍可获得焦点；原因同时作为提示框和 `aria-describedby`。
- `notices` 有 `severity`（`error` 通知会立即朗读）、可选的 `progress`（`'indeterminate'` 或 0–1）和一个 `action`（链接或回调）。更新通知只重新渲染通知本身，不会触及相机面板。
- 有侧栏时它们位于侧栏顶部；没有侧栏时位于播放栏上方。

### 选择与深层链接 {#selection-and-deep-links}

- `initialSelection`（`episodeIndex`、`segmentId`、`timeS`）在第一次加载后应用一次。查看器打开该 episode（只给 `segmentId` 时打开分段所在的 episode），选中分段，并**暂停**在包含 `timeS` 的那一帧（没有 `timeS` 时为分段的第一帧）。
- `onSelectionChange` 在打开 episode 后报告 `{ episodeIndex, segmentId, timeS }`：episode 或分段变化时立即报告，时间变化时每秒最多四次。深层链接尚未落地时不会报告，因此第一次报告就是链接落地的位置。
- 传入时间轴相同的新 `dataSource`（同一个 episode、帧数相同，例如同一录制的另一种版本）时，保留 episode、分段和帧；原本在播放就继续播放。新数据源打开期间，当前数据集保持显示（暂停），打开后一次性切换，每个相机保留最后一帧，直到新文件显示同一帧（最多 4 秒，之后显示常规的加载状态）。切换期间查看器仍可操作：期间选中的 episode 就是切换后停留的位置。新数据源打开失败时，保留当前数据源，错误中写明失败原因。时间轴不同时照常打开。

### 主题变量 {#theme-tokens}

`themeTokens` 在查看器根元素上设置 `primary`、`primaryForeground`、`radius` 和 `fontFamily`（即 CSS 变量 `--primary`、`--primary-foreground`、`--radius` 以及 `font-family`）。值可以是任意 CSS 值。浅色与深色仍由 `theme` 决定；查看器为深色时，`themeTokens.dark` 中的值替换其他值。

### 布局 {#layout}

- 相机优先获得高度：相机行取画面所需的高度，至少占面板区域的 62%，下方图表至少保留 200 px。查看器选择画面最大的排列方式（三到四个相机在一行更大时保持一行）。
- 图表数据到达之前，图表面板显示与最终图表布局相同的占位，内容不会跳动。
- 同一条时间轴：进度条、分段轨道、子任务轨道、标记、建议细条和每个图表都把同一帧放在宽度的同一比例处（共 `N` 帧时，第 `k` 帧从 `k / N` 开始；时间轴止于最后一帧的结束）。播放栏中的各行还共用同一左边缘，所有图表也共用各自的左边缘。
- 查看器宽度小于 768 px 时，可编辑的分段只显示一行“编辑需要更宽的窗口”，不显示编辑控件；播放、分段列表和导航快捷键照常可用。

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

## 提前开始加载

每次打开都要先等 Parquet 读取器（一个 WebAssembly 模块，约 1.2 MB brotli、1.6 MB gzip），以及查看器的布局和加载器代码。一旦知道将要打开查看器，就调用 `preloadLeRobotViewer()`，让这些工作与宿主自己的工作（签名 URL、读取数据源）同时进行：

```ts
import { preloadLeRobotViewer } from '@ioai/lerobot-studio';

// 在查看器的路由中、数据源就绪之前……
preloadLeRobotViewer();

// ……或在用户指向一个会打开查看器的链接时。
link.addEventListener('pointerenter', () => preloadLeRobotViewer(), { once: true });
```

- 它加载布局和加载器代码，并启动一个 Parquet Worker，由该 Worker 在后台下载并编译 WASM。下一个打开的查看器会接管这个 Worker。30 秒内没有查看器打开时，该 Worker 会被终止。
- 页面上不编译任何东西。重复调用共享同一份工作。
- 这个函数从不抛出异常，服务端渲染时不做任何事。
- 加载失败时，查看器在打开时报告 `PARQUET_ENGINE_UNAVAILABLE` 及其原因。下次打开会重试。
- 查看器挂载时也会自行开始这项工作。更早调用只是把开始时间提前。

## Worker、WebAssembly 与内容安全策略

Parquet 读取器运行在模块 Worker 中。本包把 Worker 脚本和 WASM 作为真实文件放在自身 JavaScript 旁边（`dist-lib/assets/parquet.worker-<hash>.js`、`parquet_wasm_bg-<hash>.wasm`），并用 `new URL(..., import.meta.url)` 引用。Vite、webpack 5、Turbopack（Next.js）和 Rollup 会以各自的哈希文件名、在你的 base path 下输出它们，无需任何配置。

- **只下载一次，在 Worker 中编译。** 页面从不获取或编译 WASM。每个 Worker 自行获取（第二个 Worker 和之后的访问由浏览器 HTTP 缓存提供），服务器返回 `Content-Type: application/wasm` 时边下载边编译；返回其他类型时仍可工作，只是稍慢。
- **长期缓存。** 文件名随内容变化，因此请以 `Cache-Control: public, max-age=31536000, immutable` 提供打包器输出的资源。
- **失败有名字。** Worker 脚本被拦截或缺失，或 WASM 无法下载或编译时，本次打开以错误码 `PARQUET_ENGINE_UNAVAILABLE`（`onFatalError`）结束，并注明原因。它不会被报告为数据集无效，查看器也不会无限等待。
- **导出**同样在 Worker 中写 Parquet。

**内容安全策略（CSP）。** 各策略需要：

| 策略所在                                                    | 需要                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 你的页面                                                    | `worker-src`（或 `script-src`）允许 Worker 脚本的来源，通常是 `'self'`。不需要 `'wasm-unsafe-eval'`，也不需要 `data:` |
| Worker 脚本（若服务器为其发送 CSP，例如对所有响应统一加头） | `script-src 'wasm-unsafe-eval'`，以及允许 WASM 来源（`'self'` 或你的 CDN）的 `connect-src`                            |

浏览器对 Worker 应用的是随 Worker 脚本本身下发的策略，而不是页面的策略。如果服务器不为静态文件发送 CSP，Worker 无需任何设置。

**自行托管 WASM。** 如果你的打包器不改写 `new URL(..., import.meta.url)`，或你从 CDN 提供该文件，请把 `node_modules/@ioai/lerobot-studio/dist-lib/assets/parquet_wasm_bg-<hash>.wasm` 复制到你的静态文件中，并在查看器打开前告诉它：

```ts
import { setParquetWasmUrl } from '@ioai/lerobot-studio';

setParquetWasmUrl('https://cdn.example.com/lerobot/parquet_wasm_bg-3f9a1c.wasm');
```

文件名中保留哈希（或你自己的内容哈希），以 `application/wasm` 和长期缓存提供。其他来源的 CDN 必须对你的页面允许 CORS。请在 `preloadLeRobotViewer()` 之前调用。之后再更改时，空闲的 Worker（预热的那个、导出用的那个）会被关闭，下次以新 URL 重新启动；已经打开的查看器保留它的 Worker。参数可以是绝对或相对 URL 字符串（相对于页面）、`URL` 对象，或表示使用包内文件的 `null`；其他值会抛出消息以 `INVALID_PARQUET_WASM_URL` 开头的 `TypeError`。

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

| 属性                       | 作用                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `dataSource`               | 远程归档 URL、远程文件清单或自定义 `DataSource`                            |
| `theme`                    | `light`、`dark` 或 `system`                                                |
| `language`                 | `en`、`zh` 或 `ja`（`zh` 与 `ja` 在首次渲染前按需加载）                    |
| `showSidebar`              | 显示或隐藏 Episode 侧栏                                                    |
| `showPlaybackBar`          | 显示或隐藏播放控制栏                                                       |
| `enableKeyboardShortcuts`  | 启用或关闭查看器快捷键                                                     |
| `onFatalError`             | 接收加载失败信息，并自行显示错误状态                                       |
| `onExport`                 | 用户点击宿主导出按钮时的回调                                               |
| `auxiliarySeries`          | 要绘制的额外时间序列，见[绘制额外的时间序列](#绘制额外的时间序列)          |
| `onAuxiliarySeriesWarning` | 接收额外序列的警告                                                         |
| `annotation`               | 由宿主控制的分段：`value`、`onChange`、`saveState`                         |
| `readOnly`                 | 只显示分段和审核，不显示任何编辑控件                                       |
| `fields`                   | 每个分段上可设置的值（`select`、`tags`、`text`）                           |
| `messages`                 | 按键替换任意内置文案                                                       |
| `markers`                  | 时间轴上按严重程度着色的区间，见[标记](#markers-and-read-only-suggestions) |
| `overlaySegments`          | 分段轨道上方细条中的只读分段                                               |
| `extensions`               | 宿主工具栏项和通知，见[工具栏与通知](#toolbar-and-notices)                 |
| `initialSelection`         | 打开时定位到某个 episode、分段和时间（只应用一次）                         |
| `onSelectionChange`        | 跟随 episode、分段和时间，见[选择](#selection-and-deep-links)              |
| `themeTokens`              | 在查看器根元素上设置宿主的颜色、圆角和字体                                 |

`onExport` 只是回调，不包含独立应用中的导出引擎。

提供 `onFatalError` 后，查看器不会渲染内置的致命错误状态。请在应用中保存错误信息，并自行显示合适的提示。

如果在数据集显示之前浏览器已离线，查看器会立即报告 `NETWORK_OFFLINE`（`recoverable: true`），而不是等待可能永远不会完成的读取。浏览器恢复在线后，查看器会自行重新打开数据集；宿主若显示了自己的离线状态，可在浏览器的 `online` 事件时清除它。

分段、审核与修改操作见 [API — 分段与审核](./api#segments-and-review)。自定义 `DataSource` 和完整类型列表见 [API 参考](./api)。

## 集成注意事项

- 为查看器的父元素设置明确高度。
- 查看器的根元素是带标签的 `region` 地标（不是 `main`），可以放在宿主页面自己的 `main` 里。
- 加载前会检查每个相机声明的编码（`info.features[key].info["video.codec"]`）。浏览器无法解码时，该相机显示注明编码的提示，而不是一个坏掉的播放器。
- 使用远程压缩包时，请检查 CORS 和 HTTP Range 响应头。
- 在 Next.js 中，请将查看器置于 Client Component，并使用 `ssr: false`。本包无需任何 `next.config` 配置：`next build`（Turbopack 或 webpack）会输出 Worker 与 WASM，在 `basePath` 下同样如此。
- 页面或 Worker 的内容安全策略见 [Worker、WebAssembly 与内容安全策略](#worker、webassembly-与内容安全策略)。
- 需要内置导出时，请使用独立应用。欢迎页组件只负责选数据和构造本地 `DataSource`。
