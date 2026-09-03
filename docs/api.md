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
- `createRemoteManifestDataSource` — host-owned list of per-file HTTP(S) URLs
- `createDirectoryDataSource` — File System Access directory handle

For a custom welcome page, use `LeRobotStudioProvider` with `LeRobotViewerContent`, `DatasetSourceSelector`, `SampleDatasetCard`, `Pagination`, and `useDragAndDrop`. See [Embedding](./embedding.md).

The viewer supports in-session episode changes when the dataset allows them. `onExport` is a callback for your host UI; it does not export anything by itself.

---

## Custom data sources

Implement `DataSource` if your application needs to read bytes or text by path. Treat paths and content as untrusted, and release object URLs in `clear()`.

Loading phases are `download`, `index`, `gunzip`, and `read`. Fatal errors include invalid sources, unavailable remote URLs, unsupported archives, and dataset-loading failures.

---

## Generated API report

<!--@include: ../etc/lerobot-studio.api.md-->
