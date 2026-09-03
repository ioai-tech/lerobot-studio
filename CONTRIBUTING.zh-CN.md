# 为 LeRobot Studio 贡献

> **Language / 语言：** [English](./CONTRIBUTING.md) | [简体中文](./CONTRIBUTING.zh-CN.md)

## 开发环境

要求：Node.js 24 与 npm 11.7.0。

```bash
npm ci
npm run fixtures:generate
npm run dev
```

提交 Pull Request 前，请运行 `npm run format:check`、`npm run lint`、
`npm run typecheck`、`npm run test:unit` 以及相关的构建目标。若变更影响浏览器、兼容性或 npm 消费者，请一并运行对应检查。

## 架构准则

本仓库只有一个可发布包。保持依赖方向为 `web → react → platform → core`；UI 由 React 与应用共享。`core` 不得依赖 React 与浏览器 API；WASM、Worker 与文件系统集成留在 `src/platform`。公开 npm API 为 `src/react/index.ts`。

稳定 1.0 库仅提供查看能力、仅 ESM/CSR、仅浏览器，目标 React `^19.0.0`。请勿向稳定公开 API 添加编辑或导出服务、SSR/RSC 路径、CommonJS 输出、遥测或未记录的网络调用。已文档化的欢迎页 UI（Provider、查看器内容、数据源选择、样例卡片、分页、目录数据源、拖拽）可以进入公开 API，供嵌入方做自定义欢迎页；不要把导出引擎加进去。

## 兼容性与数据完整性

在修改加载器、校验器、媒体处理、导出、打包或浏览器 API 前，请阅读 [兼容性](./docs/compatibility.zh-CN.md)。

- 将数据集输入视为不可信，并保护源数据不被修改。
- 仅按声明的精确版本支持 LeRobot `v2.1` 与 `v3.0`。
- 未知版本保持带警告的只读；在 UI 与服务层均须阻止导出。
- 在官方 LeRobot 训练就绪测试对完整输出通过之前，不得宣称导出受支持。
- 为行为变更添加 fixture 与回归测试；浏览器兼容性声明须记录实际浏览器版本。

## Pull Request

保持变更聚焦，并说明用户可见行为、兼容性影响、测试证据、隐私/安全影响与迁移步骤。公开 API 变更须遵循 [弃用策略](./docs/deprecation.zh-CN.md)。须由维护者与必需的 CODEOWNERS 审批；作者不得自行批准自己的 PR。

贡献即表示你同意在仓库 [MIT 许可证](./LICENSE) 下授权你的贡献。

## 行为准则

请遵守 [CODE_OF_CONDUCT.zh-CN.md](./CODE_OF_CONDUCT.zh-CN.md)。

## 安全

请通过 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md) 报告漏洞。

使用问题与支持边界见 [SUPPORT.zh-CN.md](./SUPPORT.zh-CN.md)。
