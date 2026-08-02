# Migrating to a fresh GitHub repository

This branch is prepared to be copied into a new public GitHub repository
**without private Git history**.

## Steps

1. Create an empty public repository (recommended: `ioai-tech/lerobot-studio`).
2. Copy the final worktree (exclude `.git`, `node_modules`, `dist`, build caches):

```bash
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
  --exclude 'dist' --exclude 'dist-lib' \
  ./ /path/to/lerobot-studio-public/
```

3. Initialize a clean history:

```bash
cd /path/to/lerobot-studio-public
git init -b main
git add .
git commit -m "chore: initial public release of LeRobot Studio"
git remote add origin git@github.com:ioai-tech/lerobot-studio.git
git push -u origin main
```

4. Configure GitHub:
   - Protect `main`
   - Add `NPM_TOKEN` repository secret for releases
   - Enable GitHub Packages / GHCR permissions for Actions
   - Verify Actions workflows run on the first PR
   - Connect the repo to Cloudflare Workers Builds for `main` → https://lerobot.studio
     (no Cloudflare API tokens needed in GitHub Secrets; use Cloudflare’s Git integration)
   - Confirm Worker `lerobot-studio` and custom domain `lerobot.studio` remain bound

5. Cut the first release tag (`v1.0.0` or `v0.1.0`) to exercise the release workflow.
