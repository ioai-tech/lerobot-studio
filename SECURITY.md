# Security Policy

> **Language / 语言：** [English](./SECURITY.md) | [简体中文](./SECURITY.zh-CN.md)

## Supported versions

After `1.0.0` is released, security fixes are provided for the latest minor
release in major version 1. Older minors may receive a coordinated upgrade path
rather than a backport. Unreleased branches, development snapshots, forks,
third-party deployments, and modified distributions receive best-effort
support only.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

After the public GitHub migration, submit a private GitHub security advisory
from the repository’s **Security → Advisories → Report a vulnerability** page.
Until that repository and advisory form are available, email
`io@io-ai.tech` with the subject “LeRobot Studio security report”. Do not send
secrets or sensitive dataset content in the first message.

Include:

- A description of the issue
- Steps to reproduce
- Impact assessment
- Any known mitigations

Do not include sensitive dataset content unless maintainers request a minimal,
sanitized reproducer through the private advisory.

## Response targets

These are service targets, not guarantees:

- acknowledgment within 3 business days;
- initial severity and scope assessment within 7 business days;
- a private status update at least every 7 business days while an accepted
  report remains unresolved;
- critical-severity remediation target: 7 calendar days after confirmation;
- high-severity remediation target: 30 calendar days after confirmation; and
- moderate/low-severity remediation target: the next appropriate scheduled
  release.

Complex dependency, browser, or coordinated-disclosure cases may take longer.
Maintainers will explain material delays in the private advisory.

## Disclosure and release

Maintainers validate the report, assign severity based on practical impact,
prepare fixes and advisories privately, and coordinate disclosure with the
reporter. Please allow a reasonable remediation period before public
disclosure. Security releases may shorten the normal deprecation window.

The project will publish an advisory when users need to act and will credit the
reporter unless anonymity is requested. Release authority follows
[GOVERNANCE.md](./GOVERNANCE.md).

## Supply-chain security

Pull requests are checked by CI, dependency review, and CodeQL. Scheduled
OpenSSF Scorecard analysis reports repository-level supply-chain findings.
Workflow permissions are read-only by default; jobs that upload security
results or publish releases receive only their required permissions. Actions
outside the release workflow are pinned to full commit SHAs and tracked by
Dependabot.

Repository administrators must separately enable and verify the GitHub security
features and branch rules described in
[docs/github-migration.md](./docs/github-migration.md). Checked-in workflows do
not prove that those settings are active. Report a suspected compromised
dependency, action, package, release artifact, or maintainer credential through
the private vulnerability channel above.

## Scope

In scope are vulnerabilities in this repository’s distributed web application
and npm package, including unsafe parsing of untrusted datasets, cross-origin or
storage boundary violations, unintended data disclosure, dependency or build
compromise, and bypass of read-only/export restrictions. Service availability,
remote dataset hosts, host-application code, unsupported browsers, and social
engineering are normally out of scope unless they demonstrate a project defect.
