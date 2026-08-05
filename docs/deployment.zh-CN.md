# 部署

> **Language / 语言：** [English](/deployment) | [简体中文](./deployment)

本页面向部署独立应用或维护其托管环境的人员。

## 生产（Cloudflare Workers）

线上站点：**https://lerobot.studio**

将 `ioai-tech/lerobot-studio` 接入 Cloudflare Workers Builds，使合并到 `main` 即可部署，无需在 GitHub 存放 Cloudflare API token。生产部署限制在受保护的 `main`；不要给 fork PR 工作流 Cloudflare 凭据。

配置：[`wrangler.jsonc`](https://github.com/ioai-tech/lerobot-studio/blob/main/wrangler.jsonc)

- Worker：`lerobot-studio`
- 资源：`dist`
- SPA 回退：`not_found_handling = "single-page-application"`
- 域名：`lerobot.studio`

推荐 Workers Builds 设置：

| 设置                         | 值                                          |
| ---------------------------- | ------------------------------------------- |
| Build command                | `npm ci && npm run build`                   |
| Deploy command               | `npx wrangler deploy`（或 Cloudflare 默认） |
| Root                         | 仓库根目录                                  |
| `SITE_URL` / `VITE_SITE_URL` | `https://lerobot.studio`                    |

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
- `VITE_SAMPLE_DATASETS_MANIFEST_URL` — `sample-datasets.manifest.json` 的完整 URL（未设置时欢迎页不显示样例列表）

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

仓库已通过 GitHub Actions 部署文档。维护该部署时：

1. 保持 **Settings → Pages** 的 **Source** 为 **GitHub Actions**。
2. 修改工作流或域名设置后，验证 `https://ioai-tech.github.io/lerobot-studio/`。
3. 若合并需要文档部署，将工作流的 `build` 与 `deploy` 作业加入受保护分支策略。
4. 如果增加自定义域，请在 GitHub Pages 中配置、添加所需 DNS 记录、启用 HTTPS，并在公开地址前完成验证。
5. 对于根自定义域如 `docs.lerobot.studio`，将工作流 `DOCS_BASE` 改为 `/`。在 GitHub Pages 与 DNS 均确认之前，不要添加 `CNAME` 文件或宣传该主机名。

工作流仅在 deploy 作业中需要 `pages: write` 与 `id-token: write`。Pull Request 通过只读 CI 作业构建相同站点，但不部署。

## 示例数据集与 CORS

示例数据集归档**不会**随本仓库分发。生产或自托管构建可通过以下环境变量注入远程 manifest：

- `VITE_SAMPLE_DATASETS_MANIFEST_URL` — manifest JSON 的完整 URL。

相对路径的 `archiveFile` / `coverImageFile` 会相对 manifest 所在目录解析；若
manifest 提供可选的 `baseUrl`，则相对该基址。未设置该环境变量时，欢迎页不显示样例列表。在持有已授权样例资产的部署机上生成 manifest：

```bash
node scripts/generate-sample-manifest.mjs \
  --dir ./storage \
  --baseUrl https://examples.example.com/samples/ \
  --out ./temp/sample-datasets.manifest.json
```

远程归档须允许跨源 `GET`。大型归档的可扩展访问还需要字节 Range。典型的对象响应包括：

- `Access-Control-Allow-Origin: https://your-viewer.example`（或对真正公开、无凭据的对象使用 `*`）；
- `Accept-Ranges: bytes`；
- `Content-Length`；
- 客户端发送 `Range: bytes=...` 时的 `206 Partial Content` 与有效 `Content-Range`；以及
- 当浏览器代码需要读取这些头时的
  `Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range`。

若发生 preflight，请允许 `GET`、`OPTIONS` 与 `Range` 请求头。带凭据请求不要使用通配符源。忽略 Range 的服务器可能触发完整下载，不是受支持的大型数据集配置。完整网络边界见 [兼容性](./compatibility)。

## 隐私

npm 库和开源 Web 外壳不包含使用分析。部署者负责说明其添加的日志、分析、代理、样例端点、认证和保留策略。见 [隐私](./privacy)。
