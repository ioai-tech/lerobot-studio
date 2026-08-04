# 迁移到全新的 GitHub 仓库

> **Language / 语言：** [English](./github-migration.md) | [简体中文](./github-migration.zh-CN.md)

本分支已准备好复制到新的公开 GitHub 仓库，**不包含私有 Git 历史**。

## 步骤

1. 创建空的公开仓库（推荐：`ioai-tech/lerobot-studio`）。
2. 复制最终 worktree（排除 `.git`、`node_modules`、`dist`、构建缓存）：

```bash
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
  --exclude 'dist-lib' \
  ./ /path/to/lerobot-studio-public/
```

3. 初始化干净历史：

```bash
cd /path/to/lerobot-studio-public
git init -b main
git add .
git commit -m "chore: initial public release of LeRobot Studio"
git remote add origin git@github.com:ioai-tech/lerobot-studio.git
git push -u origin main
```

4. 配置 GitHub（以下为管理员手工操作；本仓库中的文件不会启用仓库或组织设置）：
   - 在 **Settings → Actions → General** 中，将默认工作流 token 设为只读，并禁用 “Allow GitHub Actions to create and approve pull requests”。
   - 在 Fork Pull Request 设置中，不要向来自 Fork 的工作流发送 write token 或 Actions secret。要求首次或外部贡献者批准。已检入的 PR 工作流使用 `pull_request` 而非 `pull_request_target`，默认请求只读 contents，且不消耗仓库 secret。
   - 为 `main` 创建分支 ruleset：要求 Pull Request、至少一次批准、CODEOWNERS 审查、对话解决与必需检查成功；阻止 force push 与删除。在 CI 作业（`quality`、`browser-tests`、`official-compat`）、Dependency Review 与 CodeQL 检查各运行一次后选中它们，以便 GitHub 暴露精确检查名称。
   - 创建 `CODEOWNERS` 引用的 `@ioai-tech/maintainers` 团队，或替换为已有 write 权限的团队。
   - 在 **Settings → Code security** 中启用依赖图、Dependabot 告警与安全更新、secret scanning 与 push protection，以及私有漏洞报告。使用已检入的 CodeQL advanced-setup 工作流；不要同时启用 CodeQL default setup。
   - 验证 Dependency Review、CodeQL 与 OpenSSF Scorecard 工作流成功。Scorecard 发布会向 `api.scorecard.dev` 发送公开仓库评估数据；若不需要该发布，请在 `.github/workflows/scorecard.yml` 中禁用 `publish_results`。
   - 在组织策略支持的情况下，将 GitHub Actions 限制为 GitHub -authored 与明确批准的第三方 actions。所有非 release 工作流 pin 到完整 commit SHA，并由 Dependabot 配置提议 GitHub Actions 更新。
   - 为初始 `v1.0.0` 发布添加一次性 `NPM_BOOTSTRAP_TOKEN` 仓库 secret。在 scoped 包存在之前，npm 无法配置 trusted publisher。
   - `v1.0.0` 存在后立即为 `ioai-tech/lerobot-studio` 与 `.github/workflows/release.yml` 配置 npm Trusted Publishing，然后删除 bootstrap secret。后续发布使用 GitHub OIDC，无需 npm token。
   - 为 Actions 启用 GitHub Packages / GHCR 权限。
   - 为 `v*` 添加 tag ruleset，使仅 release 维护者可创建或更新 release 标签。
   - 验证 Actions 工作流在首个 PR 上运行。
   - 在 **Settings → Pages** 中选择 **GitHub Actions** 作为源，运行 Documentation Pages 工作流，并验证项目 Pages URL。自定义 `docs.lerobot.studio` 域与其 DNS 记录是可选的后续管理员工作；本仓库未预配置。
   - 将仓库连接到 Cloudflare Workers Builds，使 `main` → https://lerobot.studio（GitHub Secrets 中无需 Cloudflare API token；使用 Cloudflare Git 集成）。
   - 确认 Worker `lerobot-studio` 与自定义域 `lerobot.studio` 保持绑定。

5. 完成 [兼容性](./compatibility) 中的每个门禁，包括精确数据集版本处理与官方训练就绪验证。
6. 运行 `Release Dry Run` 工作流。它执行可复用 CI、`npm publish --dry-run`、CycloneDX SBOM 生成，以及无需 release 凭据的无 push 容器构建。
7. 遵循
   [治理](https://github.com/ioai-tech/lerobot-studio/blob/main/GOVERNANCE.md)
   批准并发布稳定 `v1.0.0`。已发布的 npm 版本、容器标签与 GitHub release 制品不可变；release 附带 SBOM 与来源证明。
