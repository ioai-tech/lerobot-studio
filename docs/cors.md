# CORS and HTTP Range

> **Language / 语言：** [English](./cors.md) | [简体中文](./cors.zh-CN.md)

The browser fetches a remote archive from the URL supplied by the host or user.
That archive server controls CORS, byte-range behavior, authentication, and
request logging.

## Required response behavior

For a public, credential-free archive, a typical configuration includes:

```http
Access-Control-Allow-Origin: *
Accept-Ranges: bytes
Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range
```

When the viewer requests `Range: bytes=0-65535`, the server should return:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-65535/123456789
Content-Length: 65536
```

If a preflight occurs, allow:

```http
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Range
```

Use the viewer origin instead of `*` for credentialed requests. Never combine
`Access-Control-Allow-Origin: *` with credentials.

## Why Range matters

A server that ignores `Range` may force the browser to download the complete
archive before inspection. That behavior is not a supported large-dataset
configuration. Redirects, CDNs, and signed URLs must preserve both the CORS
headers and `206 Partial Content` behavior.

## Host responsibilities

The embedding application owns private credentials, signed-URL generation,
proxies, and authorization. The stable viewer does not accept or manage server
credentials. Prefer short-lived signed URLs over exposing object-store secrets
to browser code.

See [Troubleshooting](./troubleshooting.md) for checks to run when a remote
archive does not open.
