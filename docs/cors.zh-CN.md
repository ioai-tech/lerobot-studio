# CORS 与 HTTP Range

> **Language / 语言：** [English](./cors.md) | [简体中文](./cors.zh-CN.md)

浏览器从宿主或用户提供的 URL 获取远程归档。该归档服务器控制 CORS、字节 Range 行为、认证与请求日志。

## 必需的响应行为

对于公开、无凭据的归档，典型配置包括：

```http
Access-Control-Allow-Origin: *
Accept-Ranges: bytes
Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range
```

当查看器请求 `Range: bytes=0-65535` 时，服务器应返回：

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-65535/123456789
Content-Length: 65536
```

若发生 preflight，请允许：

```http
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Range
```

带凭据的请求请使用查看器源而非 `*`。切勿将 `Access-Control-Allow-Origin: *` 与凭据组合使用。

## 为何 Range 重要

忽略 `Range` 的服务器可能迫使浏览器在检查前下载完整归档。该行为不是受支持的大型数据集配置。重定向、CDN 与签名 URL 必须同时保留 CORS 头与 `206 Partial Content` 行为。

## 宿主职责

嵌入应用负责私有凭据、签名 URL 生成、代理与授权。稳定查看器不接受或管理服务器凭据。相比向浏览器代码暴露对象存储密钥，更推荐使用短生命周期签名 URL。

远程归档无法打开时的检查步骤见 [故障排查](./troubleshooting)。
