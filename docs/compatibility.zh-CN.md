# 兼容性

> **Language / 语言：** [English](/compatibility) | [简体中文](./compatibility)

本页列出 `1.0.0` 已验证的版本和运行环境。2026-08-05 的测试记录见 [发布证据](./release-evidence-1.0.0)。

---

## 概览

| 项目       | 支持情况                                              |
| ---------- | ----------------------------------------------------- |
| React      | `^19.0.0`                                             |
| 构建       | ESM 和浏览器客户端渲染                                |
| 数据集     | `v2.1` 和 `v3.0` 完全支持                             |
| 其他版本   | 只有较新的 `v2` 和 `v3` minor 版本会以只读方式打开    |
| 遥测       | npm 包不发送使用数据                                  |
| 破坏性变更 | 主版本 1 内遵循语义化版本 — [弃用策略](./deprecation) |

CI 覆盖 Vite 应用和纯客户端的 Next.js 集成。

---

## 数据集

| `codebase_version`             | 可用功能   | 导出                                    |
| ------------------------------ | ---------- | --------------------------------------- |
| `v2.1`                         | 查看和编辑 | 已通过官方 LeRobot `v0.6.1` reader 验证 |
| `v3.0`                         | 查看和编辑 | 同上                                    |
| 较新的 `v2` 或 `v3` minor 版本 | 仅查看     | 不支持                                  |
| `v2.0`、其他主版本或缺失版本   | 不打开     | 不支持                                  |

完全支持的版本需要精确匹配。只有 `v2` 和 `v3` 系列中较新的 minor 版本会获得只读兼容；应用不会将其他相近或未来版本当作兼容版本。

导出功能只在独立应用中提供，不属于 npm API。导出结果已通过 LeRobot `v0.6.1` 验证。视频布局见 [数据格式](./data-formats)。

`v3.0` 子任务查看和导出已对照官方 Hub 数据集 [`lerobot/libero_10_subtask`](https://huggingface.co/datasets/lerobot/libero_10_subtask) 和 [`lerobot/pusht-subtask`](https://huggingface.co/datasets/lerobot/pusht-subtask) 验证。下载命令见 [数据格式 — 官方 Hub 示例](./data-formats#official-hub-examples)。

---

## 输入

| 输入       | 期望                                                         |
| ---------- | ------------------------------------------------------------ |
| 本地归档   | `.zip` / `.tar` / `.tar.gz` / `.tgz`                         |
| 本地文件夹 | 可拖放或选择目录；非 File System Access 浏览器刷新后无法恢复 |
| 远程归档   | CORS + 大文件要 Range — [CORS](./cors)                       |
| 样例       | 可选；只有构建时配了样例环境变量才会出现                     |

认证、签名 URL 和代理由嵌入应用或部署环境配置。

---

## 浏览器

见 [浏览器支持](./browser)。Chromium 有完整浏览器测试；Firefox 和 WebKit 有冒烟测试。视频播放也取决于浏览器对编解码器的支持。

固定使用 LeRobot `v0.6.1` 读取器验证。Nightly 任务也会检查上游 `main` 分支，但该检查不阻断发布。
