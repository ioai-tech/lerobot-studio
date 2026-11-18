# API

> **Language / 语言：** [English](./api.md) | [简体中文](/zh-CN/api)

This page documents the public API for `@ioai/lerobot-studio`. The package provides the viewer, helpers for a custom welcome page, archive and directory data-source factories, and their types. It does not include the standalone application's export engine.

The generated report below is the canonical API reference. Update the source code, run `npm run api:report`, and do not edit the generated report directly.

---

## Example

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

<LeRobotViewer dataSource="https://example.com/dataset.zip" theme="system" />;
```

`dataSource` can be a remote archive URL or a custom `DataSource`:

- `createArchiveDataSourceFromFile` — local ZIP / TAR / TAR.GZ
- `createArchiveDataSourceFromUrl` — remote archive you want to reuse
- `createRemoteManifestDataSource` — host-owned list of per-file HTTP(S) URLs; options `refresh`, `expiresAt` and `episodeScope` ([refresh expiring URLs](./embedding.md#refresh-expiring-urls))
- `createEpisodeSetDataSource` — episodes from many one-episode recordings, signed lazily ([episode sets](./embedding.md#show-episodes-from-many-recordings))
- `createDirectoryDataSource` — File System Access directory handle

For a custom welcome page, use `LeRobotStudioProvider` with `LeRobotViewerContent`, `DatasetSourceSelector`, `SampleDatasetCard`, `Pagination`, and `useDragAndDrop`. See [Embedding](./embedding.md).

`auxiliarySeries` adds time series from separate parquet files to the charts ([extra time series](./embedding.md#plot-extra-time-series)).

The viewer supports in-session episode changes when the dataset allows them. `onExport` is a callback for your host UI; it does not export anything by itself.

---

## Segments and review

`LeRobotViewer` can show, edit and review _segments_: inclusive frame ranges inside an episode that export as their own episodes. A host passes four props.

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
    label: 'Outcome',
    kind: 'select',
    options: [
      { value: 'success', label: 'Success', key: '1' },
      { value: 'failure', label: 'Failure', key: '2' },
    ],
  },
  { id: 'tags', label: 'Tags', kind: 'tags', suggestions: ['occluded'] },
];

<LeRobotViewer
  dataSource={source}
  annotation={{
    value, // AnnotationDocument
    onChange: (change: AnnotationChange) => save(change), // persist, then pass the new value back
    saveState, // { kind: 'saving' | 'saved' | 'offline' | 'reloaded' | 'refused' | 'idle', message?, actions? }
    createSegmentId: () => uuidv7(),
  }}
  fields={fields}
  messages={{ 'segments.title': 'Takes' }}
/>;
```

- **`annotation`** makes the segments host-controlled. `value` is an `AnnotationDocument`: segments keyed by `episode_index`; an episode with no entry or no segments is used whole. The viewer shows each change at once and calls `onChange` with one typed `AnnotationChange` per step. The host applies it (the exported `applyChange(doc, change, ctx)` is the reference reducer), persists it, and passes the new `value` back, which replaces the preview. Changes reach `onChange` in order; answer them in that order. To refuse one, keep `value` and set a new `saveState` object with `kind: 'refused'` and a `message` (one per refused change); the viewer drops the oldest change in flight and its undo step, and shows the reason. Without `onChange` the document is view-only. `canDelete(segment)` hides deletion per segment, and `newSegmentReview` sets the review state of segments a person creates (default `'confirmed'`). Without `annotation`, segments live in the viewer's session and editing needs **Edit episodes** on a writable dataset.
- `value` and `saveState` are compared by identity. Keep the same object until something changes: a host that rebuilds `value` every render replays the changes in flight and re-checks the undo history each time, and each new `saveState` object with `kind: 'refused'` refuses the oldest change in flight. Changes made faster than the host answers are kept and shown on top of each new `value` until the host's `value` contains them.
- **`readOnly`** always wins: no edit control is rendered and no edit key acts, whatever `annotation` contains. Segments, review states, field values and host badges (`segment.status`) are still shown, and navigation keys still work. A segment with `readOnly: true` refuses edits on its own.
- **`fields`** declares the values a person sets on a segment, in order: `select` (one option; an option's `key` from `1` to `9` sets it from the keyboard), `tags` (a string list, with optional `suggestions`), or `text`. Values are stored in `segment.values[field.id]`. The reducer refuses an unknown field or a value that does not fit its kind.
- **`messages`** replaces built-in copy by key (`LeRobotMessageKey`, all `segments.*` keys) in the current language. Values are ICU messages; `{{name}}` placeholders are accepted too.

### Changes and their inverses

Every change is one of eight ops. Undo sends the inverse change through `onChange`; the viewer keeps the last 100 steps and never sends a history snapshot.

| Op        | Effect                                                                                                                                                               | Inverse sent by Undo              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `create`  | Adds a segment                                                                                                                                                       | `delete`                          |
| `update`  | Changes `startFrame`, `endFrame`, `task`, `subtasks` or `values` (`values` merges key by key; `null` clears a key)                                                   | `update` with the old values      |
| `delete`  | Removes a segment                                                                                                                                                    | `restore` with the full segment   |
| `restore` | Brings a deleted segment back                                                                                                                                        | `delete`                          |
| `split`   | Left part keeps `id` (`startFrame..atFrame-1`), right part gets `newId`; task, values, review and origin are copied; a crossing subtask is cut                       | `merge`                           |
| `merge`   | `withId` must be the next segment; keeps the first task, values and origin, joins tag lists, is confirmed only if both were; a subtask cut by a split is joined back | `unmerge`                         |
| `unmerge` | Restores both segments exactly                                                                                                                                       | `merge`                           |
| `confirm` | Sets `review: 'confirmed'`                                                                                                                                           | none: confirming cannot be undone |

Redo resends the forward change; a redone `split` asks `createSegmentId` for a fresh `newId`, and a redone `create` is sent as `restore`. Editing never changes `review`. A change that breaks a rule is refused with a typed `AnnotationRefusalCode` (for example `SEGMENT_OVERLAP`, `RANGE_OUTSIDE_EPISODE`, `MERGE_NOT_ADJACENT`); values are never clamped.

The full key table is in the [User Guide](./user-manual.md#split-and-review-episodes).

---

## Custom data sources

Implement `DataSource` if your application needs to read bytes or text by path. Treat paths and content as untrusted, and release object URLs in `clear()`.

Optional members: `episodeScope` limits the dataset to some `episode_index` values. `invalidateObjectUrl(path)` is called when a URL the viewer got from `getObjectUrl` fails, `subscribeUrlChanges(listener)` tells the viewer which paths have new URLs so videos can switch without losing their place, and `focusEpisode(episodeIndex)` is a hint that the viewer is about to read that episode (lazy sources can prefetch what follows).

Typed errors: `RemoteSourceError` (manifest reads) and `EpisodeSetError` (episode sets) carry a machine-readable `code`.

Loading phases are `download`, `index`, `gunzip`, and `read`. Fatal errors include invalid sources, unavailable remote URLs, unsupported archives, and dataset-loading failures.

---

## Generated API report

<!--@include: ../etc/lerobot-studio.api.md-->
