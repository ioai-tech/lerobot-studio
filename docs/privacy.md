# Privacy

## Data processing

LeRobot Studio is designed to process dataset content in the browser. Opening a
local file or directory does not intentionally upload its contents. Opening a
remote archive necessarily sends requests to the user-provided remote host, and
that host may log normal request data such as IP address, user agent, referrer,
and requested URL.

The `@ioai/lerobot-studio` npm library has a zero-telemetry contract. It must not
send analytics, diagnostics, dataset metadata, filenames, usage events, or
identifiers to IO-AI.TECH or third parties. Host applications remain
responsible for disclosing any telemetry or network behavior they add around
the library.

## Browser storage

The current application may store:

- UI preferences such as theme and language in `localStorage`;
- recent-source metadata in `localStorage`, including labels, source kinds,
  remote URLs, and local path-like display labels; and
- user-granted `FileSystemHandle` objects in the `lerobot-studio` IndexedDB
  database when the browser supports handle persistence.

Dataset payload bytes are not intentionally persisted in these stores by the
history feature. A stored handle does not bypass browser permission checks; the
browser may require the user to grant access again. Private browsing,
permissions, quota, or browser policy may disable persistence without disabling
all viewing.

Users can remove recent items in the application. Clearing site data in browser
settings removes the application’s `localStorage` and IndexedDB data. Removing
browser storage does not delete source files or data held by remote hosts.

## Network boundaries

The standalone application may contact:

- the URL explicitly opened by the user;
- configured sample-dataset endpoints; and
- same-origin application assets.

The npm library must not introduce undisclosed network destinations. Embedding
applications should apply an appropriate Content Security Policy and document
their own sample endpoints, proxies, authentication, logging, and retention.

## Sensitive datasets

Do not assume that browser-local processing makes a dataset non-sensitive.
Filenames, paths, video frames, images, task descriptions, and sensor data may
contain personal or confidential information. Use a trusted device and origin,
review remote URLs before opening them, and follow the dataset owner’s access
and retention requirements.
