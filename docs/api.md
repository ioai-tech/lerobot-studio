# Stable API

> **Language / 语言：** [English](./api.md) | [简体中文](./api.zh-CN.md)

The generated API report is the source of truth for the publishable surface.
The stable `1.0` contract is **viewer-only**: it contains the viewer, browser
data-source factories, and their public types. Product internals, source
mutation, editing, and export services are not public API.

::: warning Publication status
The package is preparing for `1.0.0` and has not been published. The API report
describes the intended stable surface, but publication still depends on the
[1.0 release gates](./compatibility.md).
:::

## Primary entry point

```tsx
import { LeRobotViewer } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';

<LeRobotViewer
  dataSource="https://example.com/dataset.zip"
  theme="system"
  onFatalError={(error) => {
    console.error(error.code, error.message);
  }}
/>;
```

`dataSource` accepts either a remote archive URL or a custom `DataSource`.
Use `createArchiveDataSourceFromFile` for a local ZIP, TAR, or TAR.GZ archive,
and `createArchiveDataSourceFromUrl` when you need a reusable remote source.

The optional `onExport` prop is only a host-owned UI callback. It does not
export data and does not make export part of the stable npm API.

## Custom data sources

A custom `DataSource` supplies browser-readable bytes and text by path. It may
also provide path listing and object URL lifecycle methods. Implementations
must treat dataset content as untrusted input and should release object URLs
and other resources from `clear()`.

Progress callbacks use the `download`, `index`, `gunzip`, and `read` loading
phases. Fatal viewer errors are classified as invalid source, unavailable
remote source, unsupported archive, or dataset load failure.

## Generated API report

The following section is included directly from
`etc/lerobot-studio.api.md`. Update public declarations through the library
source and `npm run api:report`; do not hand-edit the report or duplicate it
here.

<!--@include: ../etc/lerobot-studio.api.md-->
