# 支持

> **Language / 语言：** [English](./SUPPORT.md) | [简体中文](./SUPPORT.zh-CN.md)

LeRobot Studio 是社区支持的开源软件。本文档不承诺响应时间、可用性、兼容性或修复义务。安全报告使用 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md) 中的单独目标。

## 提问渠道

- 可复现的产品缺陷：公开迁移完成后，在 `ioai-tech/lerobot-studio` 的 GitHub Issues 提交
- 功能与兼容性建议：公开迁移完成后，在 GitHub Issues 中说明用例、数据集版本与迁移影响
- 漏洞：仅通过 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md) 私有报告
- 贡献：[CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)

在完成 GitHub 迁移清单之前，公开 Issue 跟踪器视为不可用。开 Issue 前请搜索已有报告，并在最新受支持版本上复现。请提供 LeRobot `codebase_version`、浏览器与 OS 版本、输入类型、最小复现、控制台错误，以及问题出现在独立应用还是 npm 包中。请移除凭据、签名 URL、个人数据与机密数据集内容。

## 支持边界

稳定 1.0 的支持范围限于已文档化的查看器 API、精确的 LeRobot `v2.1` 与 `v3.0`、受支持的浏览器/输入组合以及已文档化的部署行为。见 [兼容性](./docs/compatibility.zh-CN.md)。

以下情况不在社区支持范围内，除非能在上述边界内复现项目缺陷：

- 自定义或未知 LeRobot 格式与手工修复的数据集；
- SSR、React Server Components、CommonJS、Node.js 执行，或文档约定范围外的 React 版本；
- 宿主应用代码、认证、代理、CORS 配置、远程存储可用性与浏览器编解码器可用性；
- Fork、私有补丁、不受支持的发行版与第三方部署；
- 数据集恢复、标注、训练、模型质量或机器人学建议；
- 在官方训练就绪验证完成之前保证导出。

未知数据集版本不是受支持格式。1.0 目标是在可能时提供安全的、带警告的只读检查，并禁止导出。

## 商业支持

本仓库不承诺私有或商业支持。与 IO-AI.TECH 的任何单独协议由该协议管辖，而非项目 Issue 或本文档。
