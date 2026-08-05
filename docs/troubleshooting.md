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

## Next.js reports a server-side error

Use a Client Component and `dynamic(..., { ssr: false })`. This package runs only in the browser. See [Embedding Guide](./embedding.md).

---

## Custom DataSource leaking memory

Revoke object URLs in `invalidateObjectUrl()` / `clear()`, drop archive handles, and don't keep unbounded full-file buffers. You own the lifecycle — [API](./api.md).
