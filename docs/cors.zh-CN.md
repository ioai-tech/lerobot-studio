# CORS 与 HTTP Range

> **Language / 语言：** [English](/cors) | [简体中文](./cors)

远程归档会从你提供的 URL 请求。CORS、Range、认证和访问日志均由该服务器控制。

---

## 公开文件、不带凭据

```http
Access-Control-Allow-Origin: *
Accept-Ranges: bytes
Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range
```

查看器请求 `Range: bytes=0-65535` 时，应返回：

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-65535/123456789
Content-Length: 65536
```

如果发生预检请求：

```http
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Range
```

使用 cookie 或凭据时，请回显查看器源站；不要将 `*` 与凭据请求同时使用。

---

## 为什么要 Range

服务器不支持 `Range` 时，浏览器可能需要先下载整个归档才能查看。小文件通常可以接受，但大型归档不适合这种方式。重定向、CDN 和签名 URL 都应保持 CORS 和 `206` 响应行为。

---

## 宿主应用的职责

将密钥、签名 URL 和代理保留在服务端。优先使用短时有效的签名 URL，不要在页面中暴露对象存储密钥。

仍无法打开？请查看 [故障排查](./troubleshooting)。
