# Architecture

LeRobot Studio is an npm workspaces monorepo:

```
apps/web                 Standalone SPA + Docker static hosting
packages/core            Pure TypeScript domain logic
packages/platform        Browser / WASM / FS Access adapters
packages/react           Public React library (@ioai/lerobot-studio)
packages/ui              Shared shadcn Base UI primitives (official CLI source)
```

`packages/ui` is the only UI component source. Components are generated with the
shadcn CLI (`base-nova` / Base UI) and must not be hand-forked from Radix. Theme
tokens live in `packages/ui/src/globals.css` and are consumed by
`packages/react/src/index.css`.

## Dependency rules

```
apps/web → packages/react → packages/platform → packages/core
                 ↘ packages/ui ↗
```

Forbidden:

- `core` importing React or DOM APIs
- `platform` importing React UI
- reverse imports (`core` → `platform`, `react` → `apps/web`)

## Data flow

1. Open a dataset (`DirectoryDataSource`, zip/tar sources, remote archive, sample manifest)
2. `LeRobotDataLoader` validates and adapts v2/v3 metadata
3. Workers parse Parquet into Arrow IPC
4. React contexts expose dataset / playback / selection state
5. `ViewerLayout` renders Sidebar + Dockview panels + PlaybackBar
6. Export pipeline writes metadata/data/videos through `ExportAdapter`

## Public library API

The publishable surface is `packages/react/src/index.ts`:

- `LeRobotViewer`, `LeRobotStudioProvider`, `ViewerLayout`, `LeRobotContent`
- Selected utilities / types re-exported from core and platform
- Styles via `@ioai/lerobot-studio/style.css`
