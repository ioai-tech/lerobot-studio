# 变更日志

> **Language / 语言：** [English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)

本项目的所有重要变更将记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 未发布

### Added

- 单包源码布局，逻辑边界为 `core`、`platform`、`ui`、`react`、`web`
- 包标识 `@ioai/lerobot-studio`（MIT）
- 应用与库外壳共享的 `ViewerLayout`
- 公开组合根 `LeRobotStudioProvider`
- `tests/fixtures/datasets` 下的最小合成 LeRobot v2/v3 fixture
- GitHub Actions CI、夜间浏览器测试与发布工作流（npm + GHCR）
- 治理、支持、安全响应目标、隐私披露、兼容性矩阵、CODEOWNERS 与弃用策略

### Changed

- 将稳定 1.0 库契约定义为仅查看、仅 ESM/CSR、仅浏览器、React `^19.0.0`、零遥测，且在 major 1 内向后兼容
- 定义精确支持 LeRobot `v2.1` 与 `v3.0`；其他声明版本视为未知，而非前缀兼容
- 将未知版本只读警告、阻止导出、浏览器验证、消费者验证与官方训练就绪导出归类为 1.0 发布门禁，而非当前已验证能力

### Removed

- 内部 GitLab CI / 私有部署配置
- 开源 Web 外壳中的 Google Analytics 与 Microsoft Clarity
- 硬编码 monorepo `export` 复制脚本
