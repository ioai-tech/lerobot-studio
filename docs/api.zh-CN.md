# API

> **Language / 语言：** [English](/api) | [简体中文](./api)

本页说明 `@ioai/lerobot-studio` 的公开 API。这个包提供查看器、自定义欢迎页组件、归档与目录数据源工厂及其类型；不包含独立应用中的导出引擎。

文末自动生成的报告是完整 API 参考。修改源码后运行 `npm run api:report`，不要直接编辑生成的报告。

---

## 示例

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

<LeRobotViewer dataSource="https://example.com/dataset.zip" theme="system" />;
```

`dataSource` 可以是远程归档 URL，也可以是自定义 `DataSource`：

- `createArchiveDataSourceFromFile` — 本地 ZIP / TAR / TAR.GZ
- `createArchiveDataSourceFromUrl` — 要复用的远程归档
- `createRemoteManifestDataSource` — 宿主已签名的逐文件 HTTP(S) URL 清单；选项 `refresh`、`expiresAt` 与 `episodeScope`（[刷新会过期的 URL](./embedding#刷新会过期的-url)）
- `createEpisodeSetDataSource` — 来自多个单 episode 录制的 episode，按需签名（[episode 集合](./embedding#展示多个录制中的-episode)）
- `createDirectoryDataSource` — File System Access 目录句柄

自定义欢迎页时，使用 `LeRobotStudioProvider`，再搭配 `LeRobotViewerContent`、`DatasetSourceSelector`、`SampleDatasetCard`、`Pagination` 与 `useDragAndDrop`。见 [嵌入](./embedding)。

`auxiliarySeries` 把单独 parquet 文件中的时间序列加入图表（[额外的时间序列](./embedding#绘制额外的时间序列)）。

数据集支持时，查看器可以在当前会话中修改 Episode。`onExport` 只是宿主 UI 的回调，不会自行导出数据。

---

## 分段与审核 {#segments-and-review}

`LeRobotViewer` 可以显示、编辑和审核*分段*：Episode 内的闭区间帧范围，导出时各自成为一个 Episode。宿主通过四个属性控制。

```tsx
import {
  LeRobotViewer,
  applyChange,
  type AnnotationChange,
  type AnnotationDocument,
  type AnnotationField,
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
  { id: 'tags', label: '标签', kind: 'tags', suggestions: ['遮挡'] },
];

<LeRobotViewer
  dataSource={source}
  annotation={{
    value, // AnnotationDocument
    onChange: (change: AnnotationChange, { changeId }) => save(change, changeId), // 持久化后把新的 value 传回
    saveState, // { kind: 'saving' | 'saved' | 'offline' | 'reloaded' | 'refused' | 'idle', message?, changeIds?, actions? }
    createSegmentId: () => uuidv7(),
  }}
  fields={fields}
  messages={{ 'segments.title': '片段' }}
/>;
```

- **`annotation`** 让分段由宿主控制。`value` 是 `AnnotationDocument`：按 `episode_index` 存放分段；没有条目或没有分段的 Episode 整段使用。查看器立即显示每次修改，并以每步一个带类型的 `AnnotationChange` 调用 `onChange`。宿主应用修改（导出的 `applyChange(doc, change, ctx)` 是参考 reducer）、持久化，然后把新的 `value` 传回以替换预览。修改按顺序传给 `onChange`，每个都带一个稳定的 `changeId`。拒绝修改时保持 `value` 不变，并把 `saveState` 设为 `{ kind: 'refused', message, changeIds }` 指明被拒绝的修改：查看器只丢弃这些修改（及其所属的撤销步骤）并显示原因。每个 id 只处理一次，因此重复渲染同一个拒绝不会有副作用。不传 `changeIds` 时，每个新的 `kind: 'refused'` 的 `saveState` 对象会拒绝最早一个尚未确认的修改；请传 id。当 `value` 覆盖了尚未确认的修改（其他人已保存、宿主重新加载）时，请同时把 `saveState.kind` 设为 `'reloaded'`：查看器按原样显示该 `value`，对该 `saveState` 对象丢弃一次所有尚未确认的修改（同一对象下之后的 value 视为普通应答），只保留仍然适用的撤销历史。没有 `onChange` 时文档只读。`canDelete(segment)` 可逐个分段隐藏删除，`newSegmentReview` 设置用户新建分段的审核状态（默认 `'confirmed'`）。不传 `annotation` 时，分段保存在查看器会话中，且需在可写数据集上进入 **编辑 Episode** 才能编辑。
- `value` 和 `saveState` 按引用比较。内容不变时请保持同一个对象：每次渲染都重建 `value` 的宿主会让查看器每次都重放未确认的修改并重新检查撤销历史。不带 `changeIds` 的拒绝必须每个被拒绝的修改只创建一次，否则每次重新渲染都会再拒绝一个修改；带 `changeIds` 的拒绝可以安全地重复渲染。比宿主应答更快的修改会保留，并叠加显示在每个新的 `value` 之上，直到宿主的 `value` 包含它们。
- **`readOnly`** 始终优先：无论 `annotation` 内容如何，都不渲染编辑控件，编辑快捷键也不生效。分段、审核状态、字段值和宿主标记（`segment.status`）仍会显示，导航快捷键仍可用。`readOnly: true` 的单个分段也会拒绝编辑。
- **`fields`** 按顺序声明用户可为分段设置的值：`select`（单选；选项的 `key` 为 `1` 到 `9` 时可用键盘设置）、`tags`（字符串列表，可带 `suggestions`）或 `text`。值存放在 `segment.values[field.id]`。reducer 会拒绝未知字段或类型不符的值。
- **`messages`** 按键（`LeRobotMessageKey`：嵌入的查看器能显示的每一条文案，列在 `LEROBOT_MESSAGE_KEYS` 中）替换当前语言的内置文案。值为 ICU 消息，也接受 `{{name}}` 占位符。

时间轴：共 `N` 帧的 episode 中，第 `k` 帧在每条轨道、标记行和图表上占 `[k / N, (k + 1) / N)`。播放到最后一帧时，进度条的填充止于 `(N − 1) / N`，显示的总时长是最后一帧的结束时刻（`N / fps`），与分段的出点时间一致。

标记（`markers`，会进入 **有问题** 筛选）、只读建议（`overlaySegments`）、宿主工具栏项和通知（`extensions`）、深层链接（`initialSelection`、`onSelectionChange`）以及 `themeTokens` 见[构建完整的宿主](./embedding#build-a-complete-host)。

### 修改及其逆操作

每次修改都是以下八种操作之一。撤销会通过 `onChange` 发送逆操作；查看器保留最近 100 步，从不发送历史快照。

| 操作      | 效果                                                                                                                                    | 撤销时发送的逆操作       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `create`  | 新增分段                                                                                                                                | `delete`                 |
| `update`  | 修改 `startFrame`、`endFrame`、`task`、`subtasks` 或 `values`（`values` 按键合并，`null` 清除该键）                                     | 带旧值的 `update`        |
| `delete`  | 删除分段                                                                                                                                | 携带完整分段的 `restore` |
| `restore` | 恢复已删除的分段                                                                                                                        | `delete`                 |
| `split`   | 左半保留 `id`（`startFrame..atFrame-1`），右半使用 `newId`；复制任务、字段值、审核状态和来源；跨越拆分点的子任务被切开                  | `merge`                  |
| `merge`   | `withId` 必须是下一个分段；保留第一个分段的任务、字段值和来源，合并标签列表，两者都已确认时结果才是已确认；被拆分切开的子任务会重新连接 | `unmerge`                |
| `unmerge` | 精确恢复两个分段                                                                                                                        | `merge`                  |
| `confirm` | 设为 `review: 'confirmed'`                                                                                                              | 无：确认无法撤销         |

重做会重新发送正向修改；重做 `split` 时会调用 `createSegmentId` 生成新的 `newId`，重做 `create` 以 `restore` 发送。编辑永远不会改变 `review`。违反规则的修改会以带类型的 `AnnotationRefusalCode` 被拒绝（例如 `SEGMENT_OVERLAP`、`RANGE_OUTSIDE_EPISODE`、`MERGE_NOT_ADJACENT`），不会自动修正数值。

完整快捷键表见 [使用指南](./user-manual#split-and-review-episodes)。

---

## 自定义数据源

如果应用需要按路径读取字节或文本，请实现 `DataSource`。路径和内容都应视为不可信输入，并在 `clear()` 中释放 object URL。

可选成员：`episodeScope` 把数据集限制在部分 `episode_index` 上。查看器从 `getObjectUrl` 得到的 URL 失败时会调用 `invalidateObjectUrl(path)`；`subscribeUrlChanges(listener)` 告诉查看器哪些路径有了新 URL，视频可以切换而不丢失播放位置；`focusEpisode(episodeIndex)` 提示查看器即将读取该 episode（按需加载的数据源可以预取其后的内容）；`readRange(path, start, end?)` 读取文件的一部分（语义同 `Blob.slice`，`start` 为负数时读取末尾的若干字节），返回 `ByteRangeResult`（`bytes`、`start`、整个文件的 `size`，以及已知时文件版本的 `etag`）。有 `readRange` 时，图表只读取 parquet 文件尾和所选 episode 的列块；服务器忽略范围请求时数据源返回整个文件（`start` 为 0，`bytes.length === size`），查看器随后整文件读取该文件。远程清单、episode 集合和本地文件夹数据源都实现了它。

类型化错误：`RemoteSourceError`（清单读取）和 `EpisodeSetError`（episode 集合）带有机器可读的 `code`。`RANGE_SIZE_UNKNOWN` 表示范围读取无法得知文件大小（没有 `sizeBytes`，也读不到 `Content-Range`）。

加载阶段包括 `download`、`index`、`gunzip` 和 `read`。致命错误包括无效数据源、远程 URL 不可用、不支持的归档和数据集加载失败。

---

## 生成的 API 报告

<!--@include: ../etc/lerobot-studio.api.md-->
