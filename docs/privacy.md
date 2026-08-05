# Privacy

> **Language / 语言：** [English](./privacy.md) | [简体中文](/zh-CN/privacy)

## Network requests and data transfer

Opening a local file or folder does **not** upload it. Opening a remote URL sends normal HTTP requests to that host. That host may log request information such as IP address, browser details, referrer, or URL under its own policies.

`@ioai/lerobot-studio` does not include analytics. It does not send usage data, filenames, or dataset metadata to a LeRobot Studio service. If your application adds tracking, document it in your own privacy notice.

---

## Browser storage

The SPA may keep:

- theme / language in `localStorage`
- recent-source labels and URLs in `localStorage`
- granted folder/file handles in IndexedDB (`lerobot-studio`) when the browser allows it

Dataset bytes are not stored there as history. Handles still require permission, and private browsing may disable persistence.

Clear browser site data to remove stored preferences, recent-source records, and saved handles. This does not delete your original files.

---

## Network behavior at a glance

| You open                                          | What happens                               |
| ------------------------------------------------- | ------------------------------------------ |
| Local file or folder                              | Data stays on the device                   |
| Remote or sample URL                              | Requests go to that URL's origin           |
| A deployment with extra proxies or authentication | The deployer is responsible for disclosure |

Remote archive headers: [CORS](./cors.md).
