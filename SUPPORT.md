# Support

LeRobot Studio is community-supported open-source software. No response time,
availability, compatibility, or remediation commitment is created by this
document. Security reports use the separate targets in
[SECURITY.md](./SECURITY.md).

## Where to ask

- Reproducible product defects: after the public migration, use GitHub Issues
  in `ioai-tech/lerobot-studio`
- Feature and compatibility proposals: after the public migration, use GitHub
  Issues with the use case, dataset version, and migration impact
- Vulnerabilities: private reporting only through
  [SECURITY.md](./SECURITY.md)
- Contributions: [CONTRIBUTING.md](./CONTRIBUTING.md)

The public issue tracker is not considered available until the GitHub migration
checklist is complete. Before opening an issue, search existing reports and
test the latest supported release. Include the LeRobot `codebase_version`,
browser and OS versions, input type, minimal reproduction, console errors, and
whether the issue occurs in the standalone app or npm package. Remove
credentials, signed URLs, personal data, and confidential dataset content.

## Supported boundary

For stable 1.0, support is limited to the documented viewer API, exact LeRobot
`v2.1` and `v3.0`, supported browser/input combinations, and documented
deployment behavior. See [Compatibility](./docs/compatibility.md).

The following are outside community support unless a project defect can be
reproduced within that boundary:

- custom or unknown LeRobot formats and manually repaired datasets;
- SSR, React Server Components, CommonJS, Node.js execution, or React versions
  outside the documented range;
- host-application code, authentication, proxies, CORS configuration, remote
  storage availability, and browser codec availability;
- forks, private patches, unsupported releases, and third-party deployments;
- dataset recovery, annotation, training, model quality, or robotics advice;
  and
- guaranteed export before official training-readiness validation is complete.

Unknown dataset versions are not supported formats. The 1.0 target is safe,
warning-marked read-only inspection when possible, with export prohibited.

## Commercial support

This repository does not promise private or commercial support. Any separate
agreement with IO-AI.TECH is governed by that agreement, not by project issues
or this document.
