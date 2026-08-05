# 弃用策略

> **Language / 语言：** [English](/deprecation) | [简体中文](./deprecation)

LeRobot Studio 对公开 `@ioai/lerobot-studio` API 遵循 Semantic Versioning。

## Major 版本 1

- Minor 与 patch 发布须与已文档化的公开 API 与行为保持向后兼容。
- 弃用须在 changelog 与迁移指南中记录。
- 已弃用的公开 API 在下一个 major 发布移除前，至少保留一个 minor 发布且至少 90 天，以较长者为准。
- 安全、隐私、法律或数据完整性问题可能需要更快移除。发布说明须解释例外，并在可行时提供缓解或迁移指南。
- 未文档化的内部实现、`src/**` 路径、生成文件与独立 Web 应用 UI 细节不是公开 API。

## 数据集与浏览器支持

移除已文档化的数据集版本、浏览器类别、输入方式或导出目标属于 breaking change。新增对新的精确 LeRobot 版本的支持不是自动的：需要明确验证与文档。

警告须标识已弃用能力、替代方案，以及可能移除的最早发布。静默行为变更不是可接受的弃用机制。
