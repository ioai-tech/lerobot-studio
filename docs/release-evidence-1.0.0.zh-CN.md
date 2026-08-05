# 发布证据 — 1.0.0

> **Language / 语言：** [English](/release-evidence-1.0.0) | [简体中文](./release-evidence-1.0.0)

维护者批准日期：**2026-08-05**  
固定官方 LeRobot：**v0.6.1** @ `7e241bd630a3719a56157a497ce5d08f244784f1`

## 自动化门禁（本地复跑）

| 门禁                                        | 命令 / 制品                                                            | 结果             |
| ------------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| 单元 + 版本                                 | `npm run test:unit`                                                    | 236 通过，4 跳过 |
| 官方 reader 往返                            | `LEROBOT_PYTHON=… npm run test:compat`                                 | 4 通过           |
| 浏览器 smoke（Chromium / Firefox / WebKit） | `npm run test:browser:smoke`                                           | 45 通过          |
| UI 声明的归档类型                           | `.zip`、`.tar`、`.tar.gz`、`.tgz`（`SourceController` + 归档相关测试） | 已覆盖           |
| 零遥测                                      | 应用外壳无分析脚本；见 [隐私](./privacy)                               | 源码审查确认     |
| 类型检查                                    | `npm run typecheck`                                                    | 通过             |

本次批准记录的 Playwright 版本：**1.62.1**。

官方训练就绪导出以 `tests/compat/*` 行使的 **`LeRobotDataset` /
`LeRobotDatasetMetadata` 加载路径** 为准（无需手工修复即可加载）。这是项目对
1.0.0 宣传边界定义的训练消费门禁。端到端 GPU 策略训练不在本仓库 CI 范围内，也不是
1.0.0 广告边界的要求。

## npm / 消费者

- 包标识：`@ioai/lerobot-studio@1.0.0`
- 消费者验证：CI `npm-consumer` + `test:npm-consumer:docker`（Vite / Next 纯客户端）
- React peer：`^19.0.0`

## 样例

样例归档**不**随仓库分发。托管演示可在构建时设置
`VITE_SAMPLE_DATASETS_MANIFEST_URL`。

## 第三方

见 [NOTICE](https://github.com/ioai-tech/lerobot-studio/blob/main/NOTICE) 中的
`mediabunny`（MPL-2.0）与 Geist（OFL-1.1）。
