---
layout: home

hero:
  name: LeRobot Studio
  text: Inspect LeRobot datasets in the browser
  tagline: A client-only React viewer for synchronized video, charts, and raw features.
  actions:
    - theme: brand
      text: Quick Start
      link: /quick-start
    - theme: alt
      text: Stable API
      link: /api
    - theme: alt
      text: Live demo
      link: https://lerobot.studio

features:
  - title: Viewer-only contract
    details: Embed the stable client-side viewer without exposing dataset mutation or editor APIs.
  - title: Browser-local processing
    details: Local dataset content stays on the device. The npm library has a zero-telemetry contract.
  - title: Explicit compatibility
    details: Exact dataset versions, browser capabilities, and release gates are documented separately.
---

## Current release status

LeRobot Studio is preparing the stable `1.0.0` contract. The package is not yet
published. Viewing is the only stable public library workflow; source mutation,
editing, and export services are not part of the stable API.

Start with the [Quick Start](./quick-start.md), then review the
[compatibility and release gates](./compatibility.md) before treating a dataset
format or browser capability as supported.
