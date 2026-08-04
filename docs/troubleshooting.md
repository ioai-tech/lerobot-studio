# Troubleshooting

> **Language / 语言：** [English](./troubleshooting.md) | [简体中文](./troubleshooting.zh-CN.md)

## The viewer has zero height

`LeRobotViewer` fills its container. Give the host element an explicit height
or a layout constraint that resolves to a non-zero height.

```tsx
<div style={{ height: 720, minHeight: 480 }}>
  <LeRobotViewer dataSource={source} />
</div>
```

## A remote archive does not open

1. Confirm the final URL is reachable with `GET` from the viewer origin.
2. Inspect redirects; every final response must preserve the required CORS
   headers.
3. Send a small byte request and verify a `206 Partial Content` response with a
   valid `Content-Range`.
4. Expose `Accept-Ranges`, `Content-Length`, and `Content-Range` to browser
   code.
5. Check whether a signed URL expired or a CDN removed the `Range` header.

See [CORS and HTTP Range](./cors.md) for example headers.

## An archive type is rejected

The public archive factory accepts ZIP, TAR, and TAR.GZ files. For remote
sources, use a URL and response that allow the archive kind to be identified.
Use `onFatalError` to distinguish `UNSUPPORTED_ARCHIVE` from network and
dataset failures.

## A dataset opens with a warning

Only exact declared versions `v2.1` and `v3.0` are intended for 1.0 support.
Any other or missing `codebase_version` is unknown. Safe inspection may remain
available in warning-marked read-only mode, but export must stay disabled.

## Video is unavailable

Playback depends on the browser and codec used by the dataset. Test the same
asset in the target browser and inspect its media errors. A viewer smoke test
does not establish support for every codec. Non-media data should remain
inspectable where safe.

## Next.js fails during server rendering

Render the viewer from a Client Component and load it dynamically with
`ssr: false`. The package is browser-only and does not support React Server
Components or server rendering. See [Quick Start](./quick-start.md).

## A custom data source leaks memory

Revoke generated object URLs in `invalidateObjectUrl()` or `clear()`, release
archive handles, and ensure repeated reads do not retain full buffers without a
bounded cache. The host owns the lifecycle of a custom
[`DataSource`](./api.md).
