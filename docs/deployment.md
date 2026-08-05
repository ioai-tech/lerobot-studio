# Deployment

> **Language / 语言：** [English](./deployment.md) | [简体中文](/zh-CN/deployment)

This page is for people deploying the standalone application or maintaining its hosting.

## Production (Cloudflare Workers)

Live site: **https://lerobot.studio**

Connect `ioai-tech/lerobot-studio` to Cloudflare Workers Builds so merges to
`main` deploy without storing a Cloudflare API token in GitHub. Restrict
production deploys to protected `main`; do not give fork PR workflows Cloudflare
credentials.

Config: [`wrangler.jsonc`](https://github.com/ioai-tech/lerobot-studio/blob/main/wrangler.jsonc)

- Worker: `lerobot-studio`
- Assets: `dist`
- SPA fallback: `not_found_handling = "single-page-application"`
- Domain: `lerobot.studio`

Recommended Workers Builds settings:

| Setting                      | Value                                         |
| ---------------------------- | --------------------------------------------- |
| Build command                | `npm ci && npm run build`                     |
| Deploy command               | `npx wrangler deploy` (or Cloudflare default) |
| Root                         | repository root                               |
| `SITE_URL` / `VITE_SITE_URL` | `https://lerobot.studio`                      |

Local dry-run:

```bash
SITE_URL=https://lerobot.studio npm run build
npx wrangler deploy
```

## Docker

```bash
docker build -t lerobot-studio .
docker run --rm -p 8080:8080 lerobot-studio
```

Or use the root `docker-compose.yml` (maps host port 8080):

```bash
docker compose up --build
```

Optional build args:

- `BASE_PATH` — subdirectory deploy path (e.g. `/lerobot/`)
- `SITE_URL` — canonical site URL for SEO assets (production default: `https://lerobot.studio`)
- `VITE_SAMPLE_DATASETS_MANIFEST_URL` — full URL to `sample-datasets.manifest.json` (when unset, the welcome page hides the samples list)

## Static hosting

```bash
SITE_URL=https://lerobot.studio npm run build
```

Serve `dist` with any static file server. Configure SPA fallback to
`index.html`.

## Documentation site (GitHub Pages)

The documentation is a separate VitePress build:

```bash
npm run docs:build
```

`.github/workflows/docs-pages.yml` builds and deploys
`docs/.vitepress/dist` after documentation changes reach `main`. Its default
`DOCS_BASE` is `/<repository-name>/`, so it works at the GitHub project Pages
URL without assuming that a custom documentation domain exists.

The repository is configured to deploy its documentation through GitHub Actions. When maintaining that deployment:

1. Keep **Settings → Pages** set to **GitHub Actions**.
2. Verify `https://ioai-tech.github.io/lerobot-studio/` after changes to the workflow or domain settings.
3. Add the workflow’s `build` and `deploy` jobs to the protected-branch policy
   if documentation deployment is required for merges.
4. If you add a custom domain, configure it in GitHub Pages, add the required DNS records, enable HTTPS, and verify the domain before publishing the URL.
5. For a root custom domain such as `docs.lerobot.studio`, change the workflow
   `DOCS_BASE` to `/`. Do not add a `CNAME` file or advertise that hostname
   until GitHub Pages and DNS both confirm it.

The workflow requires `pages: write` and `id-token: write` only in the deploy
job. Pull requests build the same site through the read-only CI job but do not
deploy it.

## Sample datasets and CORS

Sample dataset archives are **not** shipped in this repository. Production or
self-hosted builds may inject a remote manifest with:

- `VITE_SAMPLE_DATASETS_MANIFEST_URL` — full URL to the manifest JSON.

Relative `archiveFile` / `coverImageFile` paths resolve against the manifest
directory, or against optional `manifest.baseUrl` when present. When the env var
is unset, the welcome page hides the samples list. Generate a
manifest on a deployment machine that holds authorized assets:

```bash
node scripts/generate-sample-manifest.mjs \
  --dir ./storage \
  --baseUrl https://examples.example.com/samples/ \
  --out ./temp/sample-datasets.manifest.json
```

Remote archives must allow cross-origin `GET`. Scalable access to large
archives also requires byte ranges. A typical object response includes:

- `Access-Control-Allow-Origin: https://your-viewer.example` (or `*` for a
  genuinely public, credential-free object);
- `Accept-Ranges: bytes`;
- `Content-Length`;
- a `206 Partial Content` response with a valid `Content-Range` when the client
  sends `Range: bytes=...`; and
- `Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range`
  when those headers must be read by browser code.

If a preflight occurs, allow `GET`, `OPTIONS`, and the `Range` request header.
Do not use wildcard origins with credentialed requests. A server that ignores
Range may trigger a full download and is not a supported large-dataset setup.
See [Compatibility](./compatibility.md) for the complete network boundary.

## Privacy

The npm library and open-source web shell do not include usage analytics.
Deployers are responsible for documenting any logs, analytics, proxies, sample
endpoints, authentication, and retention policies they add. See [Privacy](./privacy.md).
