# CORS and HTTP Range

> **Language / 语言：** [English](./cors.md) | [简体中文](/zh-CN/cors)

Remote archives are requested from the URL you provide. CORS, range requests, authentication, and access logging are configured by that server.

---

## Public file, no credentials

```http
Access-Control-Allow-Origin: *
Accept-Ranges: bytes
Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range
```

When the viewer asks for `Range: bytes=0-65535`, answer with:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-65535/123456789
Content-Length: 65536
```

If the browser preflights:

```http
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Range
```

Using cookies / credentials? Echo the viewer origin — never combine `*` with credentials.

---

## Why Range matters

Without `Range` support, the browser may need to download the entire archive before it can display data. This is suitable only for small archives. Redirects, CDNs, and signed URLs should preserve CORS and `206` response behavior.

---

## Deployment considerations

Keep secrets, signed URLs, and proxy credentials on the server. Prefer short-lived signed URLs to exposing object-storage keys in the page.

Still stuck? [Troubleshooting](./troubleshooting.md).
