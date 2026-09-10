---
'@ioai/lerobot-studio': patch
---

Override transitive `js-yaml` 3.15.2 / 4.3.2 and `hono` 4.13.7 to clear `npm audit` (GHSA-2883-xcg3-v3hh and the hono 4.13.5+ security fixes). These packages are not runtime app dependencies.
