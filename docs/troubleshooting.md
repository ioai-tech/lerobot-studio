# Troubleshooting

> **Language / 语言：** [English](./troubleshooting.md) | [简体中文](/zh-CN/troubleshooting)

## The viewer is blank or has no height

The component fills its parent. Give the parent an explicit height.

```tsx
<div style={{ height: 720, minHeight: 480 }}>
  <LeRobotViewer dataSource={source} />
</div>
```

---

## Remote archive won't open

1. Confirm the final URL can be fetched from the viewer's origin.
2. Check redirects: every response needs the required CORS headers.
3. For a large archive, make a range request and confirm a `206` response with a valid `Content-Range`.
4. A small archive may fall back to a full `200` download when the server does not support ranges. That fallback is limited to archives below 2 GiB.
5. Expose `Accept-Ranges`, `Content-Length`, and `Content-Range` to browser code when you use range requests.
6. Check whether a signed URL has expired or a CDN is removing the `Range` header.

Examples: [CORS](./cors.md).

---

## Archive type rejected

Supported formats are ZIP, TAR, TAR.GZ, and TGZ. For remote files, make sure the URL or response headers identify the format. Handle `onFatalError` to distinguish `UNSUPPORTED_ARCHIVE` from a network error.

---

## Opens with a warning

`v2.1` and `v3.0` are fully supported. Other versions may still open in read-only mode when they can be parsed safely. Export is unavailable for those versions.

---

## No video

Playback depends on the video codec and browser. Try the file in the target browser and inspect media errors. Charts and raw data may still work even when video does not.

---

## Part of the viewer could not load

The layout, segment panels and some dialogs load as separate files on first use. If one cannot be fetched (often after a new deployment while the tab stayed open), its place shows "Part of the viewer could not load (CHUNK_LOAD_FAILED)" with **Retry**; the rest of the viewer keeps working. If the retry fails too (browsers can keep a failed module fetch), the notice also offers **Reload page**.

---

## The Parquet reader could not load

An open that ends with `PARQUET_ENGINE_UNAVAILABLE` could not start the Parquet reader; the dataset was not read. The message names the cause:

- **worker script could not load**: the page's Content Security Policy (`worker-src`, or `script-src`) does not allow the worker scripts, or your server does not serve the bundler's assets.
- **could not compile … Content Security Policy**: your server sends the worker scripts a CSP without `'wasm-unsafe-eval'`. Add it to that policy, or stop sending a CSP with static assets.
- **HTTP 404** or **could not download**: the WASM file is not served at the URL your bundler emitted (or the one given to `setParquetWasmUrl`), a cross-origin CDN does not allow CORS, or a CSP sent with the worker scripts has a `connect-src` that does not allow the WASM's origin (the message then ends in `TypeError: Failed to fetch`).
- **could not compile … CompileError** without a CSP: the file is corrupt or not the package's WASM (for example an HTML error page).

See [Workers, WebAssembly and Content Security Policy](./embedding.md#workers-webassembly-and-content-security-policy). Retrying opens a new worker, which downloads the file again.

---

## Subtasks do not appear

Studio maps official LeRobot `subtask_index` only.

- `lerobot/libero_10_subtask` shows `Subtask N` when `meta/subtasks.parquet` is missing.
- `lerobot/pusht-subtask` shows `phase 1/2/3`; frames with `subtask_index = -1` stay **Unlabeled**.
- `k1000dai/libero-subtaskid-segments` stores `subtask_id`, not `subtask_index`, so segments are not shown.
- `v2.1` can display existing indices but cannot add labels.

Download commands: [Data formats — Official Hub examples](./data-formats.md#official-hub-examples). With **Include subtasks** checked, export to `v3.0` fails until every exported frame is labeled; the app does not write `-1`.

---

## Depth map is blank or fails to decode

Official depth datasets such as [`lerobot/outdoor-depth`](https://huggingface.co/datasets/lerobot/outdoor-depth) store 16-bit grayscale TIFF bytes in parquet (`info.is_depth_map: true`). Studio sniffs TIFF/PNG/JPEG, colorizes 16-bit depth for playback, and does not treat JPEG as the only encoding. If the panel stays empty, confirm the feature dtype is `image` or `depth` and that `observation.images.*` is present.

---

## Next.js reports a server-side error

Use a Client Component and `dynamic(..., { ssr: false })`. This package runs only in the browser. See [Embedding Guide](./embedding.md).

---

## Custom DataSource leaking memory

Revoke object URLs in `invalidateObjectUrl()` / `clear()`, drop archive handles, and don't keep unbounded full-file buffers. You own the lifecycle — [API](./api.md).
