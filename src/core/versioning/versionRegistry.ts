import type { LeRobotVersionAdapter } from './LeRobotVersionAdapter';
import type { BaseLeRobotValidator } from './validation';
import { v2Adapter } from './v2Adapter';
import { v3Adapter } from './v3Adapter';
import { V2FormatValidator } from './v2FormatValidator';
import { V3FormatValidator } from './v3FormatValidator';
import {
  classifyLeRobotVersion,
  isSupportedLeRobotVersion,
  normalizeLeRobotVersion,
} from './versionCapability';

const v2FormatValidator = new V2FormatValidator();
const v3FormatValidator = new V3FormatValidator();

/**
 * Returns an adapter for supported or same-major read-only versions.
 */
export function getAdapterForVersion(codebaseVersion: string): LeRobotVersionAdapter {
  const capability = classifyLeRobotVersion(codebaseVersion);
  if (capability.adapterVersion === 'v3.0') return v3Adapter;
  if (capability.adapterVersion === 'v2.1') return v2Adapter;
  throw new Error(`Unsupported LeRobot codebase_version: ${codebaseVersion}`);
}

/**
 * Returns the format validator for the given codebase_version.
 * Run before load; use report.hasError to decide whether to proceed.
 */
export function getValidatorForVersion(codebaseVersion: string): BaseLeRobotValidator {
  const capability = classifyLeRobotVersion(codebaseVersion);
  if (capability.adapterVersion === 'v3.0') return v3FormatValidator;
  if (capability.adapterVersion === 'v2.1') return v2FormatValidator;
  throw new Error(`Unsupported LeRobot codebase_version: ${codebaseVersion}`);
}

export { isSupportedLeRobotVersion, normalizeLeRobotVersion };
export { v2Adapter, v3Adapter };
