# Deprecation policy

> **Language / 语言：** [English](./deprecation.md) | [简体中文](/zh-CN/deprecation)

LeRobot Studio follows Semantic Versioning for the public
`@ioai/lerobot-studio` API.

## Major version 1

- Minor and patch releases must remain backward compatible with documented
  public APIs and behavior.
- Deprecations must be documented in the changelog and migration guidance.
- A deprecated public API remains available for at least one minor release and
  at least 90 days, whichever is longer, before removal in the next major
  release.
- Security, privacy, legal, or data-integrity issues may require faster removal.
  The release notes must explain the exception and provide mitigation or
  migration guidance where practical.
- Undocumented internals, `src/**` paths, generated files, and standalone web
  application UI details are not public API.

## Dataset and browser support

Removing a documented dataset version, browser class, input method, or export
target is a breaking change. Adding support for a new exact LeRobot version is
not automatic: it requires explicit validation and documentation.

Warnings must identify the deprecated capability, the replacement, and the
earliest release in which removal may occur. Silent behavior changes are not an
acceptable deprecation mechanism.
