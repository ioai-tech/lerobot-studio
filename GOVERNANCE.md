# Governance

LeRobot Studio is stewarded by IO-AI.TECH. This document defines project
decision-making and release authority; it does not grant legal authority on
behalf of the company.

## Roles

- **Contributors** propose issues, documentation, code, tests, and reviews.
- **Maintainers** triage issues, review and merge changes, enforce project
  contracts, and manage community spaces.
- **Release maintainers** are a least-privilege subset of maintainers with npm,
  GitHub release, container registry, and signing access.
- **Security maintainers** can access private security advisories and coordinate
  disclosure.

IO-AI.TECH appoints and removes maintainers based on sustained, constructive
participation, technical judgment, security practices, and availability.
Repository and team membership are the authoritative role records.

## Decisions

Routine changes use lazy consensus through reviewed pull requests. The author
does not approve their own change. Required checks and CODEOWNERS review must
pass before merge.

Changes to the stable public API, dataset compatibility, privacy or telemetry
contract, security policy, licensing, governance, or release process require:

1. a written proposal in an issue or pull request;
2. compatibility and migration analysis; and
3. approval from at least two maintainers, including a relevant CODEOWNER.

When consensus cannot be reached, IO-AI.TECH’s designated project lead makes
the final decision and records the rationale. Security maintainers may act
privately and urgently to protect users.

## Release authority

Only release maintainers may publish npm packages, GitHub releases, tags, or
official container images. Production credentials must not be available to
untrusted pull-request jobs. Releases require:

- a clean, reviewed commit on the protected release branch;
- passing required checks and acceptance gates;
- an updated changelog and version/tag agreement;
- provenance and artifact review where the release platform supports them; and
- approval by two maintainers, at least one of whom is a release maintainer.

Published versions and tags are immutable. A faulty release is followed by a
new version; tags and registry artifacts are not silently replaced. Security
releases may use an expedited private review while retaining two-person
approval.

The stable `1.0.0` release must satisfy
[Compatibility and release gates](./docs/compatibility.md), including official
LeRobot training-readiness validation for every advertised export path.

## Compatibility and deprecation

Major version 1 maintains backward compatibility for documented public APIs.
Deprecations follow [docs/deprecation.md](./docs/deprecation.md). Exact LeRobot
version support and the zero-telemetry npm contract cannot be weakened in a
minor or patch release.

## Conduct, security, and conflicts

Community participation follows [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
Vulnerabilities follow [SECURITY.md](./SECURITY.md). Maintainers disclose
material conflicts of interest and recuse themselves when impartial review is
not possible.
