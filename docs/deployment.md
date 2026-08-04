# Deployment

## Production target (Cloudflare Workers)

Production is served at **https://lerobot.studio**.

The planned post-migration setup connects `ioai-tech/lerobot-studio` directly to
a Cloudflare Worker so merges to `main` trigger a Cloudflare build and deploy
without GitHub Actions deployment secrets. The repository connection and first
deployment must be verified during the
[GitHub migration](./github-migration.md); this document does not assert that
the public repository is already available.

The Cloudflare repository integration is a separate trust boundary from GitHub
Actions. Grant it access only to this repository, restrict production deploys
to the protected `main` branch, and review its build logs and dependency update
behavior. Fork pull-request workflows must not receive Cloudflare credentials;
the planned integration does not require storing a Cloudflare API token as a
GitHub Actions secret.

Worker configuration lives in
[`wrangler.jsonc`](https://github.com/ioai-tech/lerobot-studio/blob/main/wrangler.jsonc):

- Worker name: `lerobot-studio`
- Assets directory: `dist`
- SPA fallback: `not_found_handling = "single-page-application"`
- Custom domain: `lerobot.studio` (already bound in Cloudflare)

Recommended Cloudflare build settings (dashboard / Workers Builds):

| Setting                          | Value                                         |
| -------------------------------- | --------------------------------------------- |
| Build command                    | `npm ci && npm run build`                     |
| Deploy command                   | `npx wrangler deploy` (or Cloudflare default) |
| Root directory                   | repository root                               |
| Env `SITE_URL` / `VITE_SITE_URL` | `https://lerobot.studio`                      |

Local dry-run:

```bash
SITE_URL=https://lerobot.studio npm run build
npx wrangler deploy
```

## Docker

```bash
docker build -t lerobot-studio .
docker run --rm -p 8080:80 lerobot-studio
```

Optional build args:

- `BASE_PATH` — subdirectory deploy path (e.g. `/lerobot/`)
- `SITE_URL` — canonical site URL for SEO assets (production default: `https://lerobot.studio`)
- `VITE_SAMPLES_BASE_URL` — remote sample manifest base URL

Planned published images (after a successful public release):

- `ghcr.io/ioai-tech/lerobot-studio:latest`
- `ghcr.io/ioai-tech/lerobot-studio:<version>`

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

Repository administrators must complete these steps after the public
repository exists:

1. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Run the **Documentation Pages** workflow once and verify the generated
   `https://ioai-tech.github.io/lerobot-studio/` URL.
3. Add the workflow’s `build` and `deploy` jobs to the protected-branch policy
   if documentation deployment is required for merges.
4. Only after DNS ownership is ready, configure a custom domain in GitHub
   Pages, add the documented DNS records, enable HTTPS, and verify the domain.
5. For a root custom domain such as `docs.lerobot.studio`, change the workflow
   `DOCS_BASE` to `/`. Do not add a `CNAME` file or advertise that hostname
   until GitHub Pages and DNS both confirm it.

The workflow requires `pages: write` and `id-token: write` only in the deploy
job. Pull requests build the same site through the read-only CI job but do not
deploy it.

## Sample datasets and CORS

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

The npm library has a zero-telemetry contract. The open-source web shell does
not include Google Analytics or Microsoft Clarity. Deployers are responsible
for disclosing logs, analytics, proxies, sample endpoints, authentication, and
retention that they add. See [Privacy](./privacy.md).
