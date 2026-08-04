# 部署

> **Language / 语言：** [English](./deployment.md) | [简体中文](./deployment.zh-CN.md)

## 生产目标（Cloudflare Workers）

生产环境部署于 **https://lerobot.studio**。

迁移后的计划配置将 `ioai-tech/lerobot-studio` 直接连接到 Cloudflare Worker，使合并到 `main` 触发 Cloudflare 构建与部署，而无需 GitHub Actions 部署密钥。仓库连接与首次部署须在 [GitHub 迁移](./github-migration) 期间验证；本文档不断言公开仓库已可用。

Cloudflare 仓库集成与 GitHub Actions 是独立的信任边界。仅授予对本仓库的访问，将生产部署限制在受保护的 `main` 分支，并审查其构建日志与依赖更新行为。Fork 的 Pull Request 工作流不得获得 Cloudflare 凭据；计划中的集成不需要在 GitHub Actions secret 中存储 Cloudflare API token。

Worker 配置位于
[`wrangler.jsonc`](https://github.com/ioai-tech/lerobot-studio/blob/main/wrangler.jsonc)：

- Worker 名称：`lerobot-studio`
- 资源目录：`dist`
- SPA 回退：`not_found_handling = "single-page-application"`
- 自定义域：`lerobot.studio`（已在 Cloudflare 绑定）

推荐的 Cloudflare 构建设置（控制台 / Workers Builds）：

| 设置                             | 值                                          |
| -------------------------------- | ------------------------------------------- |
| Build command                    | `npm ci && npm run build`                   |
| Deploy command                   | `npx wrangler deploy`（或 Cloudflare 默认） |
| Root directory                   | 仓库根目录                                  |
| Env `SITE_URL` / `VITE_SITE_URL` | `https://lerobot.studio`                    |

本地演练：

```bash
SITE_URL=https://lerobot.studio npm run build
npx wrangler deploy
```

## Docker

```bash
docker build -t lerobot-studio .
docker run --rm -p 8080:8080 lerobot-studio
```

也可以使用根目录的 `docker-compose.yml`（映射宿主机端口 8080）：

```bash
docker compose up --build
```

可选构建参数：

- `BASE_PATH` — 子目录部署路径（例如 `/lerobot/`）
- `SITE_URL` — SEO 资源的规范站点 URL（生产默认：`https://lerobot.studio`）
- `VITE_SAMPLES_BASE_URL` — 远程示例 manifest 基 URL

计划中的公开镜像（成功公开发布后）：

- `ghcr.io/ioai-tech/lerobot-studio:latest`
- `ghcr.io/ioai-tech/lerobot-studio:<version>`

## 静态托管

```bash
SITE_URL=https://lerobot.studio npm run build
```

用任意静态文件服务器提供 `dist`。将 SPA 回退配置为 `index.html`。

## 文档站点（GitHub Pages）

文档是独立的 VitePress 构建：

```bash
npm run docs:build
```

`.github/workflows/docs-pages.yml` 在文档变更到达 `main` 后构建并部署 `docs/.vitepress/dist`。默认 `DOCS_BASE` 为 `/<repository-name>/`，因此可在 GitHub 项目 Pages URL 工作，而不假设存在自定义文档域。

公开仓库存在后，仓库管理员须完成：

1. 打开 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
2. 运行一次 **Documentation Pages** 工作流，并验证生成的 `https://ioai-tech.github.io/lerobot-studio/` URL。
3. 若合并需要文档部署，将工作流的 `build` 与 `deploy` 作业加入受保护分支策略。
4. 仅在 DNS 所有权就绪后，在 GitHub Pages 配置自定义域、添加文档记录的 DNS 记录、启用 HTTPS 并验证域。
5. 对于根自定义域如 `docs.lerobot.studio`，将工作流 `DOCS_BASE` 改为 `/`。在 GitHub Pages 与 DNS 均确认之前，不要添加 `CNAME` 文件或宣传该主机名。

工作流仅在 deploy 作业中需要 `pages: write` 与 `id-token: write`。Pull Request 通过只读 CI 作业构建相同站点，但不部署。

## 示例数据集与 CORS

远程归档须允许跨源 `GET`。大型归档的可扩展访问还需要字节 Range。典型的对象响应包括：

- `Access-Control-Allow-Origin: https://your-viewer.example`（或对真正公开、无凭据的对象使用 `*`）；
- `Accept-Ranges: bytes`；
- `Content-Length`；
- 客户端发送 `Range: bytes=...` 时的 `206 Partial Content` 与有效 `Content-Range`；以及
- 当浏览器代码需要读取这些头时的
  `Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range`。

若发生 preflight，请允许 `GET`、`OPTIONS` 与 `Range` 请求头。带凭据请求不要使用通配符源。忽略 Range 的服务器可能触发完整下载，不是受支持的大型数据集配置。完整网络边界见 [兼容性](./compatibility)。

## 隐私

npm 库为零遥测契约。开源 Web 外壳不包含 Google Analytics 或 Microsoft Clarity。部署者负责披露其添加的日志、分析、代理、示例端点、认证与保留策略。见 [隐私](./privacy)。
