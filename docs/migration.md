# Migration

> **Language / 语言：** [English](./migration.md) | [简体中文](./migration.zh-CN.md)

## Before 1.0

The package has not been published, so there is no supported npm upgrade path
yet. Do not depend on `src/**`, generated declarations, standalone application
components, export services, or other implementation details.

Prepare an embedding application by depending only on the
[viewer-only API report](./api.md):

- `LeRobotViewer`
- `createArchiveDataSourceFromFile`
- `createArchiveDataSourceFromUrl`
- the public viewer and `DataSource` types
- `@ioai/lerobot-studio/style.css`

An `onExport` handler is a host-owned button callback, not an exported dataset
service.

## Moving from application internals

1. Replace deep imports with the package root.
2. Move export, authentication, signed URL, and proxy behavior into the host
   application.
3. Supply a remote URL or implement the stable `DataSource` interface.
4. Render only on the client and give the viewer container an explicit height.
5. Treat all non-exact dataset versions as unknown instead of choosing an
   adapter by major prefix.

## After 1.0

Major version 1 follows Semantic Versioning. Minor and patch releases retain
backward compatibility for documented public APIs. A deprecated API remains
available for at least one minor release and 90 days, except where security,
privacy, legal, or data-integrity issues require faster action.

Before upgrading:

1. read the project changelog and release notes;
2. review documented deprecations and exact dataset-version support;
3. rebuild a real Vite or client-only Next.js consumer; and
4. test target browsers and representative dataset codecs.

See the [deprecation policy](./deprecation.md) for the complete contract. The
repository publication procedure is documented separately in
[GitHub migration](./github-migration.md).
