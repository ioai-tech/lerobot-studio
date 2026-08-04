# Documentation i18n exceptions

> **Language / 语言：** [English](./i18n-exceptions.md) | [简体中文](./i18n-exceptions.zh-CN.md)

LeRobot Studio keeps English and Simplified Chinese (`.zh-CN.md`) copies of
every repository-owned Markdown file. A CI check (`npm run check:docs-i18n`)
enforces pairing or an explicit exception entry in
[`scripts/docs-i18n-exceptions.json`](../scripts/docs-i18n-exceptions.json).

## Machine-generated reports

| Path                        | Reason                                                     | Chinese entry                                                                             |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `etc/lerobot-studio.api.md` | API Extractor output; regenerate with `npm run api:report` | [`docs/api.zh-CN.md`](./api.zh-CN.md) wraps the same English report with Chinese guidance |

Do not hand-edit generated API reports or create translated copies of them.
Update public declarations in library source, run `npm run api:report`, and
keep the Chinese API page’s explanatory text in sync.

## Directories excluded from scans

These paths are intentionally **not** scanned for Markdown pairing. They do not
need exception entries:

| Directory | Reason                                                                                        |
| --------- | --------------------------------------------------------------------------------------------- |
| `temp/`   | Ephemeral build output (for example local API Extractor copies). Not published documentation. |

If a path under an excluded directory appears in `exceptions`, `check:docs-i18n`
fails as redundant.

## Adding a new exception

1. Confirm the file is generated, third-party, or otherwise unsuitable for a
   `.zh-CN.md` sibling and is **not** under a `skipScanDirs` directory.
2. Add an object to `scripts/docs-i18n-exceptions.json` with `path`, `reason`,
   `zhEntry` (path to the Chinese explanation page, or `null`), and bilingual
   `noteEn` / `noteZh` fields.
3. Document the exception on this page and in
   [`i18n-exceptions.zh-CN.md`](./i18n-exceptions.zh-CN.md).
4. Run `npm run check:docs-i18n`.
