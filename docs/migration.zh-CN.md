# 迁移

> **Language / 语言：** [English](/migration) | [简体中文](./migration)

## 只用公开 API

请从包根目录导入，详见 [API](./api)：

- `LeRobotViewer`
- `createArchiveDataSourceFromFile` / `createArchiveDataSourceFromUrl` / `createRemoteManifestDataSource`
- 公开类型（`RemoteFileEntry`、`DataSource`、查看器属性）
- `@ioai/lerobot-studio/style.css`

`onExport` 是宿主按钮钩子，不是导出引擎。

---

## 从深层应用导入迁过来

1. 将深层路径替换为包入口。
2. 将导出、认证、签名 URL 和代理保留在自己的应用中。
3. 传入 URL，或自行实现 `DataSource`。
4. 使用客户端渲染，并为容器设置明确高度。
5. 仅较新的 `v2` 或 `v3` minor 版本可以只读打开；不要仅按主版本选择适配器。

---

## 待在 1.x

请遵循语义化版本和 [弃用策略](./deprecation)。升级前，请阅读变更日志、确认所需的数据集版本、使用实际的 Vite 或纯客户端 Next 应用重新构建，并在目标浏览器和编解码器组合上进行冒烟测试。
