# Migrating to a fresh GitHub repository

> **Language / 语言：** [English](./github-migration.md) | [简体中文](/zh-CN/github-migration)

This branch is prepared to be copied into a new public GitHub repository
**without private Git history**.

## Steps

1. Create an empty public repository (recommended: `ioai-tech/lerobot-studio`).
2. Copy the final worktree (exclude `.git`, `node_modules`, `dist`, build caches):

```bash
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
  --exclude 'dist-lib' \
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

4. Configure GitHub (these are manual administrator actions; the files in this
   repository do not enable repository or organization settings):
   - In **Settings → Actions → General**, set the default workflow token to
     read-only and leave “Allow GitHub Actions to create and approve pull
     requests” disabled.
   - In the fork pull-request settings, do not send write tokens or Actions
     secrets to workflows from forks. Require approval for first-time or
     outside contributors. The checked-in PR workflows use `pull_request`
     rather than `pull_request_target`, request read-only contents by default,
     and do not consume repository secrets.
   - Create a branch ruleset for `main`: require a pull request, at least one
     approval, CODEOWNERS review, conversation resolution, and successful
     required checks; block force pushes and deletion. Select the CI jobs
     (`quality`, `browser-tests`, and `official-compat`), Dependency Review, and
     CodeQL checks after they have run once so GitHub exposes their exact check
     names.
   - Create the `@ioai-tech/maintainers` team referenced by `CODEOWNERS`, or
     replace that placeholder with an existing team that has write access
   - In **Settings → Code security**, enable the dependency graph, Dependabot
     alerts and security updates, secret scanning and push protection, and
     private vulnerability reporting. Use the checked-in CodeQL advanced-setup
     workflow; do not also enable CodeQL default setup.
   - Verify the Dependency Review, CodeQL, and OpenSSF Scorecard workflows
     succeed. Scorecard publication sends public repository assessment data to
     `api.scorecard.dev`; disable `publish_results` in
     `.github/workflows/scorecard.yml` if that publication is not desired.
   - Keep GitHub Actions restricted to GitHub-authored and explicitly approved
     third-party actions where organization policy supports it. All non-release
     workflows are pinned to full commit SHAs and Dependabot is configured to
     propose GitHub Actions updates.
   - Add a one-time `NPM_BOOTSTRAP_TOKEN` repository secret for the initial
     `v1.0.0` publication. npm cannot configure a trusted publisher before the
     scoped package exists.
   - Immediately after `v1.0.0` exists, configure npm Trusted Publishing for
     `ioai-tech/lerobot-studio` and `.github/workflows/release.yml`, then delete
     the bootstrap secret. Later releases use GitHub OIDC and no npm token.
   - Enable GitHub Packages / GHCR permissions for Actions
   - Add a tag ruleset for `v*` so only release maintainers can create or update
     release tags.
   - Verify Actions workflows run on the first PR
   - In **Settings → Pages**, choose **GitHub Actions** as the source, run the
     Documentation Pages workflow, and verify the project Pages URL. A custom
     `docs.lerobot.studio` domain and its DNS records are optional later
     administrator work; they are not preconfigured by this repository.
   - Connect the repo to Cloudflare Workers Builds for `main` → https://lerobot.studio
     (no Cloudflare API tokens needed in GitHub Secrets; use Cloudflare’s Git integration)
   - Confirm Worker `lerobot-studio` and custom domain `lerobot.studio` remain bound

5. Complete every gate in [Compatibility](./compatibility.md), including exact
   dataset-version handling and official training-readiness validation.
6. Run the `Release Dry Run` workflow. It executes the reusable CI,
   `npm publish --dry-run`, CycloneDX SBOM generation, and a no-push container
   build without requiring release credentials.
7. Follow
   [Governance](https://github.com/ioai-tech/lerobot-studio/blob/main/GOVERNANCE.md)
   to approve and cut the stable `v1.0.0` release. Published npm versions,
   container tags, and GitHub release artifacts are immutable; the release
   attaches the SBOM and provenance.
