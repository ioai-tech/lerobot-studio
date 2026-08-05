# Browser support

> **Language / 语言：** [English](./browser.md) | [简体中文](/zh-CN/browser)

Supported browsers include current Chrome, Edge, Firefox, and Safari. Video codec support varies by browser.

---

## Test coverage

Chromium runs the full browser test suite. Firefox and WebKit run smoke tests covering viewer UI, errors, basic accessibility, read-only version handling, and remote or custom sources.

| Capability                    | Chromium                             | Firefox / WebKit                   |
| ----------------------------- | ------------------------------------ | ---------------------------------- |
| Viewer and errors             | Full tests                           | Smoke tests                        |
| Remote or custom `DataSource` | Yes                                  | Smoke tests                        |
| Local archives                | Yes                                  | Yes; playback depends on codec     |
| Local folder import           | Drag, picker, and restorable handles | Drag and picker; no handle restore |
| Restorable folder handles     | File System Access                   | Not available                      |
| Directory export              | Chromium only                        | Not available                      |
| Video encoding and export     | WebCodecs suite                      | Capability check only              |
| Video playback                | Depends on codec                     | Depends on codec                   |

---

## Client-side rendering

Render in the browser. No SSR, RSC, Node, or CommonJS.

If File System Access or WebCodecs is unavailable, the related feature is disabled. Other supported panels remain available. Unsupported media shows an error without affecting the rest of the viewer.

See also [Compatibility](./compatibility.md).
