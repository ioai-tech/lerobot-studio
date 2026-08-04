# 迁移

> **Language / 语言：** [English](./migration.md) | [简体中文](./migration.zh-CN.md)

## 1.0 之前

包尚未发布，因此尚无受支持的 npm 升级路径。请勿依赖 `src/**`、生成的声明、独立应用组件、导出服务或其他实现细节。

请仅依赖 [仅查看 API 报告](./api) 准备嵌入应用：

- `LeRobotViewer`
- `createArchiveDataSourceFromFile`
- `createArchiveDataSourceFromUrl`
- 公开查看器与 `DataSource` 类型
- `@ioai/lerobot-studio/style.css`

`onExport` 处理器是宿主拥有的按钮回调，不是导出的数据集服务。

## 从应用内部实现迁移

1. 用包根导入替换深层导入。
2. 将导出、认证、签名 URL 与代理行为移入宿主应用。
3. 提供远程 URL 或实现稳定的 `DataSource` 接口。
4. 仅在客户端渲染，并为查看器容器提供明确高度。
5. 将所有非精确数据集版本视为未知，而非按 major 前缀选择适配器。

## 1.0 之后

Major 1 遵循 Semantic Versioning。Minor 与 patch 发布对已文档化的公开 API 保持向后兼容。已弃用 API 至少保留一个 minor 发布与 90 天，除非安全、隐私、法律或数据完整性问题需要更快行动。

升级前：

1. 阅读项目 changelog 与 release 说明；
2. 审查已记录的弃用说明与精确数据集版本支持；
3. 重建真实的 Vite 或纯客户端 Next.js 消费者；以及
4. 在目标浏览器与代表性数据集编解码器上测试。

完整契约见 [弃用策略](./deprecation)。仓库发布流程单独记录在 [GitHub 迁移](./github-migration)。
