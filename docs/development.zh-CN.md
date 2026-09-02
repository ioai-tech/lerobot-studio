# 开发

> **Language / 语言：** [English](/development) | [简体中文](./development)

## 环境

```bash
npm ci
npm run fixtures:generate
npm run dev
```

需要 Node 24（`.nvmrc`）。本仓库是单个 npm 包，有两个构建目标。

## 命令

| 命令                        | 用途                                |
| --------------------------- | ----------------------------------- |
| `npm run dev`               | 启动 SPA                            |
| `npm run build`             | 构建 SPA 到 `dist/`                 |
| `npm run build:lib`         | 构建已发布库到 `dist-lib/`          |
| `npm run docs:dev`          | 启动 VitePress 文档站点             |
| `npm run docs:build`        | 构建文档并检查链接                  |
| `npm run check:docs-i18n`   | 检查 Markdown 中英文配对或显式例外  |
| `npm run check:bundle-size` | 强制执行 npm 与 Web bundle 大小预算 |
| `npm run typecheck`         | 类型检查应用与库源码                |
| `npm run test:unit`         | 运行基于 Node 的 Vitest 测试        |
| `npm run test:browser`      | 运行 Playwright 浏览器测试          |
| `npm run fixtures:generate` | 重建合成 LeRobot fixture            |

## 官方本地数据集

本地 Node 和浏览器测试在这些目录缺失时会 skip。用 Hugging Face CLI 下载后，再运行 `npm run dev`（或 `npm run test:browser`）：

```bash
hf download lerobot/libero_10_subtask --type=dataset --local-dir /data/lerobot/libero_10_subtask
hf download lerobot/pusht-subtask --type=dataset --local-dir /data/lerobot/pusht-subtask
hf download k1000dai/libero-subtaskid-segments --type=dataset --local-dir /data/lerobot/libero-subtaskid-segments
hf download lerobot/outdoor-depth --type=dataset --local-dir /data/lerobot/outdoor-depth
```

| 路径                                      | 用途                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `/data/lerobot/libero_10_subtask`         | 官方 `v3.0` `subtask_index` 标准（`LEROBOT_V3_SUBTASK_DATASET`）                   |
| `/data/lerobot/pusht-subtask`             | 官方带标签的 `v3.0`，含 `meta/subtasks.parquet`（`LEROBOT_PUSHT_SUBTASK_DATASET`） |
| `/data/lerobot/libero-subtaskid-segments` | 社区 `subtask_id` 快照；不会按官方子任务映射                                       |
| `/data/lerobot/outdoor-depth`             | 官方纯深度 `v3.0`（`LEROBOT_DEPTH_DATASET`）；16 位 TIFF 帧                        |

`libero_10_subtask` 体积较大（含视频）。浏览器 e2e 使用第一份 parquet 的精简切片；Node 测试也会直接加载官方目录。`pusht-subtask` 足够小，可以完整提供。

## Bundle 大小门禁

运行大小门禁前先构建两个目标：

```bash
npm run build:lib
npm run build
npm run check:bundle-size
```

门禁测量稳定库入口、库与初始 Web CSS、Web entry/modulepreload chunk、懒加载 DataLoader 与 Dockview chunk、Worker/WASM 制品，以及打包 npm tarball 的原始与 gzip 大小。还会在缺少必需制品、意外 JavaScript chunk 超过 per-chunk 上限，或完整 npm tarball 超过 packed/unpacked 预算时失败。哈希文件名从构建输出与 `dist/index.html` 发现，而非在脚本中写死。

硬限制为当前制品之上的整齐整数上限。库 Worker chunk 体积较大，仍需优化，并非理想目标。通过此门禁仅表示 bundle 大小未出现显著回退。

本地负向测试可在不改变入库限制的情况下降低所有预算：

```bash
BUNDLE_SIZE_BUDGET_SCALE=0.01 npm run check:bundle-size
```

scale 覆盖只能收紧预算（`0 < scale <= 1`）；不能放松 CI 门禁。

## 包验证

```bash
npm run build:lib
npm run verify:npm-consumer
```

1.0 发布需要 Vite 与 Next.js 纯客户端用法的消费者 fixture、React/React DOM `^19.0.0`、ESM 导入、CSS 加载、Worker 与 WASM。服务端渲染、React Server Components、CommonJS 与 Node.js 执行不在包契约范围内。

### Docker npm 消费者门禁

CI 还会执行隔离的 Docker 构建：先从仓库生成 npm tarball，再仅安装该
tarball 到全新的 React 19 消费者中，验证类型检查、Vite 生产构建、Next.js
App Router 纯客户端构建，以及非根路径下的静态服务：

```bash
npm run test:npm-consumer:docker
```

Dockerfile 位于 `tests/npm-consumer/`。主构建上下文提供隔离的消费者 fixture，
命名 BuildKit 上下文 `lerobot=.` 提供用于打包的仓库源码。打包阶段执行
`npm run build:lib` 后再执行 `npm pack`，与正常的声明、Vite 和 API Extractor
流水线一致。本机没有 Docker 时，运行器会检查 Dockerfile 结构，并回退执行
`npm run verify:npm-consumer`。

Docker 消费者只安装打包后的 tarball，不使用 `file:../..` 或 `src/`；固定
React 19.2.8，检查公开 API 类型，并构建 Vite 与 Next App Router
（纯客户端、`ssr: false`）示例，同时验证 Vite bundle 可从非根挂载路径提供静态服务。

## 兼容性工作

版本与浏览器工作的验收来源为 [兼容性与发布门禁](./compatibility)。尤其：

- 精确匹配数据集版本（`v2.1` 与 `v3.0`），绝不按 major 前缀；
- 仅允许较新的 `v2` 和 `v3` minor 版本使用只读适配器；其他或缺失版本在任何导出 UI 或服务之前被拒绝；
- 将官方 LeRobot 训练就绪检查视为必需的导出测试；以及
- 记录实际浏览器版本与结果，而非从 API 检测推断支持。

公开行为变更须遵循 [弃用策略](./deprecation)。

## UI 组件

UI 基元位于 `src/ui`，从仓库根目录用 shadcn CLI 管理。将生成组件保留在 `src/ui/components`，使用本地 `@/ui` 或相对导入。不要重新引入 `@radix-ui/*`；优先通过 `render` 使用 Base UI 组合。

## 文档国际化

每个仓库自有英文 Markdown 文件都应有同目录 `.zh-CN.md` 副本，或在 `scripts/docs-i18n-exceptions.json` 中登记明确例外。`temp/` 等临时目录列入 `skipScanDirs`，不参与扫描。语言切换使用站点语言路由，页面正文使用相对页面链接。运行 `npm run check:docs-i18n` 验证。例外说明见 [文档国际化例外清单](./i18n-exceptions)。
