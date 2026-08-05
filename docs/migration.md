# Migration

> **Language / 语言：** [English](./migration.md) | [简体中文](/zh-CN/migration)

## Stick to the public API

Import from the package root only — see [API](./api.md):

- `LeRobotViewer`
- `createArchiveDataSourceFromFile` / `createArchiveDataSourceFromUrl`
- public types
- `@ioai/lerobot-studio/style.css`

`onExport` is a host button hook, not an export engine.

---

## Coming from deep app imports

1. Swap deep paths for the package entry.
2. Keep export, auth, signed URLs, and proxies in your app.
3. Pass a URL or implement `DataSource`.
4. Render on the client; give the container a height.
5. Treat non-exact dataset versions as unknown — don't pick adapters by major prefix.

---

## Staying on 1.x

Follow SemVer and the [deprecation policy](./deprecation.md). Before you bump: read the changelog, check which dataset versions you care about, rebuild a real Vite or client-only Next app, and smoke-test the browsers/codecs you ship.
