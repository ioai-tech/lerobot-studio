# Deployment

## Production site (Cloudflare Workers)

Production is served at **https://lerobot.studio**.

The GitHub repository [`ioai-tech/lerobot-studio`](https://github.com/ioai-tech/lerobot-studio)
is connected directly to a Cloudflare Worker. Merges to `main` trigger a Cloudflare
build and deploy — no GitHub Actions secrets are required for this path.

Worker configuration lives in [`wrangler.jsonc`](../wrangler.jsonc):

- Worker name: `lerobot-studio`
- Assets directory: `apps/web/dist`
- SPA fallback: `not_found_handling = "single-page-application"`
- Custom domain: `lerobot.studio` (already bound in Cloudflare)

Recommended Cloudflare build settings (dashboard / Workers Builds):

| Setting                          | Value                                         |
| -------------------------------- | --------------------------------------------- |
| Build command                    | `npm ci && npm run build:web`                 |
| Deploy command                   | `npx wrangler deploy` (or Cloudflare default) |
| Root directory                   | repository root                               |
| Env `SITE_URL` / `VITE_SITE_URL` | `https://lerobot.studio`                      |

Local dry-run:

```bash
SITE_URL=https://lerobot.studio npm run build:web
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

Published images (after open release):

- `ghcr.io/ioai-tech/lerobot-studio:latest`
- `ghcr.io/ioai-tech/lerobot-studio:<version>`

## Static hosting

```bash
SITE_URL=https://lerobot.studio npm run build:web
```

Serve `apps/web/dist` with any static file server. Configure SPA fallback to
`index.html`.

## Sample datasets and CORS

Remote archives require:

- CORS allowing `GET` from your site origin
- HTTP `Range` support for large archives

## Privacy

The open-source web shell does **not** include Google Analytics or Microsoft Clarity.
