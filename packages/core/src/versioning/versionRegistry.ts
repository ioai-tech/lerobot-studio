import type { LeRobotVersionAdapter } from './LeRobotVersionAdapter';
import type { BaseLeRobotValidator } from './validation';
import { v2Adapter } from './v2Adapter';
import { v3Adapter } from './v3Adapter';
import { V2FormatValidator } from './v2FormatValidator';
import { V3FormatValidator } from './v3FormatValidator';

const v2FormatValidator = new V2FormatValidator();
const v3FormatValidator = new V3FormatValidator();

/**
 * Returns the adapter for the given codebase_version (e.g. 'v2.0', 'v2.1', 'v3.0').
 * Uses prefix match: v2 -> v2Adapter, v3 -> v3Adapter.
 */
export function getAdapterForVersion(codebaseVersion: string): LeRobotVersionAdapter {
  const normalized = codebaseVersion.trim().toLowerCase();
  if (normalized.startsWith('v3')) return v3Adapter;
  if (normalized.startsWith('v2')) return v2Adapter;
  throw new Error(`Unsupported LeRobot codebase_version: ${codebaseVersion}`);
}

/**
 * Returns the format validator for the given codebase_version.
 * Run before load; use report.hasError to decide whether to proceed.
 */
export function getValidatorForVersion(codebaseVersion: string): BaseLeRobotValidator {
  const normalized = codebaseVersion.trim().toLowerCase();
  if (normalized.startsWith('v3')) return v3FormatValidator;
  if (normalized.startsWith('v2')) return v2FormatValidator;
  throw new Error(`Unsupported LeRobot codebase_version: ${codebaseVersion}`);
}

export { v2Adapter, v3Adapter };
