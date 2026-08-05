export type SupportedLeRobotVersion = 'v2.1' | 'v3.0';
export type LeRobotVersionCapabilityStatus = 'supported' | 'read-only' | 'unsupported';

export interface LeRobotVersionCapability {
  status: LeRobotVersionCapabilityStatus;
  normalizedVersion: string | null;
  adapterVersion: SupportedLeRobotVersion | null;
}

export function normalizeLeRobotVersion(codebaseVersion: unknown): string | null {
  if (typeof codebaseVersion !== 'string') return null;
  const normalized = codebaseVersion.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

/**
 * Exact releases are writable. Strictly newer minor releases in a known major
 * may be parsed by the latest same-major adapter, but remain read-only.
 */
export function classifyLeRobotVersion(codebaseVersion: unknown): LeRobotVersionCapability {
  const normalizedVersion = normalizeLeRobotVersion(codebaseVersion);
  if (normalizedVersion === 'v2.1' || normalizedVersion === 'v3.0') {
    return {
      status: 'supported',
      normalizedVersion,
      adapterVersion: normalizedVersion,
    };
  }

  const match = normalizedVersion ? /^v(2|3)\.(0|[1-9]\d*)$/.exec(normalizedVersion) : null;
  if (match) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (Number.isSafeInteger(minor) && ((major === 2 && minor > 1) || (major === 3 && minor > 0))) {
      return {
        status: 'read-only',
        normalizedVersion,
        adapterVersion: major === 2 ? 'v2.1' : 'v3.0',
      };
    }
  }

  return { status: 'unsupported', normalizedVersion, adapterVersion: null };
}

export function isSupportedLeRobotVersion(codebaseVersion: unknown): boolean {
  return classifyLeRobotVersion(codebaseVersion).status === 'supported';
}
