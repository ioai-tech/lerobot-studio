# 变更日志

## 1.2.0

### 次要变更

- 增加官方 LeRobot v3.0 子任务查看、标注与导出，以及 16 位 TIFF 深度图播放。
- 将传递依赖 `browserslist` 升级到 4.28.8，修复 GHSA-c83g-rgw3-j3cx 与 GHSA-73wf-gq98-2v4g。

## 1.1.0

### 次要变更

- 新增 `createRemoteManifestDataSource` 与 `RemoteFileEntry`，宿主可用按文件的 HTTP(S) URL 嵌入查看器。清单数据源实现 `listPaths()`，v3 episode 分片无需猜测连续路径。

## [1.0.3] - 2026-08-14

### 已修复

- 未知 `sample://` slug 会明确报错，不再静默回到欢迎页
- 远程压缩包预检增加超时与 mixed content 失败，避免无限 Preflight
- 窄屏下多路相机不再裁切最右侧画面
- 视频调试 overlay 不再在挂载时挡住画面
- v2.1 部分下载时按磁盘裁剪 episode，健康检查标出缺失文件，autoplay 不再走进不存在的集

## [1.0.2] - 2026-08-10

### 已修复

- 修复深色主题：侧栏 Tab/分割条、弹窗、图表与 scoped studio root 的语义色适配

## [1.0.1] - 2026-08-07

### 已更改

- 改进数据集质量报告：弹窗占用视口 80% 宽度，并可通过摘要计数筛选错误、警告或通过项
- 更新已发布 npm 包的中英文 README 描述，并添加 npm 版本徽标

> **Language / 语言：** [English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)

本项目的所有重要变更将记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-08-05

### Added

- 单包源码布局，逻辑边界为 `core`、`platform`、`ui`、`react`、`web`
- 包标识 `@ioai/lerobot-studio`（MIT）
- 应用与库外壳共享的 `ViewerLayout`
- 公开组合根 `LeRobotStudioProvider`
- `tests/fixtures/datasets` 下的最小合成 LeRobot v2/v3 fixture
- GitHub Actions CI、夜间浏览器测试与发布工作流（npm + GHCR）
- 治理、支持、安全响应目标、隐私披露、兼容性矩阵、CODEOWNERS 与弃用策略
- 已批准的 `1.0.0` 门禁发布证据

### Changed

- 将稳定 1.0 库契约定义为仅查看、仅 ESM/CSR、仅浏览器、React `^19.0.0`、零遥测，且在 major 1 内向后兼容
- 定义精确支持 LeRobot `v2.1` 与 `v3.0`；其他声明版本视为未知，而非前缀兼容
- 批准 1.0.0 发布门禁：未知版本只读警告、阻止导出、浏览器验证、消费者验证，以及官方 LeRobot `v0.6.1` reader 可消费的导出
- 样例数据集仅通过环境变量注入；仓库内不再附带样例 manifest

### Removed

- 内部 GitLab CI / 私有部署配置
- 开源 Web 外壳中的 Google Analytics 与 Microsoft Clarity
- 硬编码 monorepo `export` 复制脚本
- 仓库内 `public/sample-datasets.manifest.json`
