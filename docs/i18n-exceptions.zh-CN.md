# 文档国际化例外清单

> **Language / 语言：** [English](./i18n-exceptions.md) | [简体中文](./i18n-exceptions.zh-CN.md)

LeRobot Studio 为仓库内每一份英文 Markdown 维护简体中文副本（`.zh-CN.md`）。
CI 通过 `npm run check:docs-i18n` 检查配对关系，或在
[`scripts/docs-i18n-exceptions.json`](../scripts/docs-i18n-exceptions.json)
中登记显式例外。

## 机器生成报告

| 路径                        | 原因                                                 | 中文入口                                                           |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `etc/lerobot-studio.api.md` | API Extractor 输出；用 `npm run api:report` 重新生成 | [`docs/api.zh-CN.md`](./api.zh-CN.md) 以中文说明包裹同一份英文报告 |

请勿手工编辑或翻译生成的 API 报告。应修改库源码中的公开声明、运行
`npm run api:report`，并同步更新中文 API 页中的说明文字。

## 不参与扫描的目录

以下路径**不会**纳入 Markdown 配对扫描，也**不需要**登记为例外：

| 目录    | 原因                                                      |
| ------- | --------------------------------------------------------- |
| `temp/` | 临时构建输出（例如本地 API Extractor 副本），非发布文档。 |

若 `exceptions` 中出现位于上述目录下的路径，`check:docs-i18n` 会报冗余错误。

## 新增例外

1. 确认文件为生成物、第三方内容或其他不适合 `.zh-CN.md` 配对的情况，且**不在** `skipScanDirs` 目录下。
2. 在 `scripts/docs-i18n-exceptions.json` 中添加 `path`、`reason`、
   `zhEntry`（中文说明页路径，或 `null`）以及双语 `noteEn` / `noteZh`。
3. 在本页与 [`i18n-exceptions.md`](./i18n-exceptions.md) 中记录该例外。
4. 运行 `npm run check:docs-i18n`。
