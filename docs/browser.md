# Browser support

> **Language / 语言：** [English](./browser.md) | [简体中文](./browser.zh-CN.md)

LeRobot Studio targets modern browsers, but feature availability depends on
browser APIs, media codecs, dataset encoding, and deployment policy. “Modern”
does not guarantee that every video can be decoded or encoded.

## Validation scope

CI runs the full browser suite in Chromium and a compatibility smoke suite in
Firefox and WebKit. The smoke suite covers viewer composition, localized error
states, keyboard and accessibility primitives, unknown-version read-only
behavior, and remote or custom `DataSource` contracts.

| Capability                   | Chromium                    | Firefox                     | WebKit                      |
| ---------------------------- | --------------------------- | --------------------------- | --------------------------- |
| Viewer and error states      | CI smoke                    | CI smoke                    | CI smoke                    |
| Remote/custom data source    | CI smoke                    | CI smoke                    | CI smoke                    |
| Local archive viewing        | Extended validation pending | Extended validation pending | Extended validation pending |
| Restorable directory handles | Capability detected         | Archive-only fallback       | Archive-only fallback       |
| Directory export             | Chromium only               | Unavailable                 | Unavailable                 |
| Video encoding/export        | Full suite with WebCodecs   | Capability detected         | Capability detected         |
| Video playback               | Codec dependent             | Codec dependent             | Codec dependent             |

This matrix separates tested scope from intended support. Release evidence must
record actual browser versions, and all 1.0 claims remain subject to the
[release gates](./compatibility.md).

## Client-only requirement

The package accesses browser facilities and must be rendered only on the
client. It does not support SSR, hydration of server-rendered viewer markup,
React Server Components, Node.js, or CommonJS.

## Graceful degradation

Missing File System Access or WebCodecs capabilities should remove or disable
the affected operation rather than break inspection. Unsupported media should
produce a clear error while non-media inspection remains available where safe.
