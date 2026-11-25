---
'@ioai/lerobot-studio': patch
---

Dependencies updated within their ranges (among them `@base-ui/react` 1.9, `radix-ui` 1.8, `mediabunny` 1.66, `@zip.js/zip.js` 2.25, `lucide-react` 1.79, `react-window` 2.5; Vite 8.3.8, Vitest 4.1.12, ESLint 10.15, typescript-eslint 8.74, Playwright 1.65, VitePress 2.0.0-alpha.21). `npm audit` reports no vulnerabilities: Vitest 4.1.12 fixes two `@vitest/mocker` advisories (manual-mock code injection, Windows path traversal), ESLint and typescript-eslint take a fixed `minimatch`, and an override gives `@microsoft/api-extractor` `minimatch` 11 (its pinned 10.x is affected by the globparts ReDoS). The picomatch waiver is gone: the advisory no longer matches the installed version.
