# 治理

> **Language / 语言：** [English](./GOVERNANCE.md) | [简体中文](./GOVERNANCE.zh-CN.md)

LeRobot Studio 由 IO-AI.TECH stewardship。本文档定义项目决策与发布权限；不代表公司授予的法律授权。

## 角色

- **贡献者**：提出 Issue、文档、代码、测试与审查。
- **维护者**：分流 Issue、审查并合并变更、执行项目契约、管理社区空间。
- **发布维护者**：维护者中权限最小化的子集，拥有 npm、GitHub release、容器 registry 与签名访问权。
- **安全维护者**：可访问私有安全公告并协调披露。

IO-AI.TECH 根据持续、建设性的参与、技术判断、安全实践与可用性任命与撤换维护者。仓库与团队成员身份是角色的权威记录。

## 决策

常规变更通过已审查 Pull Request 的懒共识（lazy consensus）进行。作者不得自行批准自己的变更。合并前须通过必需检查与 CODEOWNERS 审查。

对稳定公开 API、数据集兼容性、隐私或遥测契约、安全策略、许可证、治理或发布流程的变更需要：

1. 在 Issue 或 Pull Request 中的书面提案；
2. 兼容性与迁移分析；以及
3. 至少两名维护者批准，其中须包含相关 CODEOWNER。

无法达成共识时，IO-AI.TECH 指定的项目负责人做最终决定并记录理由。安全维护者可私下、紧急地行动以保护用户。

## 发布权限

仅发布维护者可发布 npm 包、GitHub release、标签或官方容器镜像。生产凭据不得对不受信任的 Pull Request 作业可用。发布要求：

- 受保护发布分支上的干净、已审查提交；
- 通过必需检查与验收门禁；
- 更新的 changelog 与版本/标签一致；
- 在发布平台支持时审查来源与制品；以及
- 两名维护者批准，其中至少一人为发布维护者。

已发布版本与标签不可变。有问题的发布以后续新版本跟进；不得静默替换标签与 registry 制品。安全发布可在保留双人批准的同时采用加急私有审查。

稳定 `1.0.0` 发布须满足 [兼容性与发布门禁](./docs/compatibility.zh-CN.md)，包括对所 advertised 的每条导出路径的官方 LeRobot 训练就绪验证。

## 兼容性与弃用

Major 1 对已文档化的公开 API 保持向后兼容。弃用遵循 [docs/deprecation.zh-CN.md](./docs/deprecation.zh-CN.md)。精确的 LeRobot 版本支持与零遥测 npm 契约不得在 minor 或 patch 中削弱。

## 行为、安全与利益冲突

社区参与遵循 [CODE_OF_CONDUCT.zh-CN.md](./CODE_OF_CONDUCT.zh-CN.md)。漏洞遵循 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md)。维护者须披露重大利益冲突，并在无法 impartial 审查时回避。
