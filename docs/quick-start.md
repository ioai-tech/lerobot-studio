# Quick Start

> **Language / 语言：** [English](./quick-start.md) | [简体中文](/zh-CN/quick-start)

This page helps you start with the standalone application. To embed the viewer in a React application, see [Embed LeRobot Studio in React](./embedding.md).

## Open the app

Go to [lerobot.studio](https://lerobot.studio). You do not need to install anything.

Choose one of the following:

1. **Local folder** for an unpacked dataset.
2. **Local archive** for a `.zip`, `.tar`, `.tar.gz`, or `.tgz` file.
3. **Remote archive** for an HTTP(S) URL.

Local files are processed in the browser and are not uploaded to a cloud service. When you open a remote archive, the browser requests it from the URL you provide.

## View the dataset

After the dataset opens:

1. Select an episode in the left sidebar.
2. Use the playback controls to move through frames.
3. Compare video, charts, and raw values for the same frame.
4. Open **Dataset health check** if you want to look for common format problems.

For editing, export, shortcuts, and panel layout, read the [User Guide](./user-manual.md).

## Remote archives

For large remote datasets, the file server should support cross-origin requests and HTTP byte ranges. See [CORS and HTTP Range](./cors.md).

## Next steps

- Supported dataset versions and archive types: [Data formats](./data-formats.md)
- Browser requirements: [Browser support](./browser.md)
- Problems opening data: [Troubleshooting](./troubleshooting.md)
