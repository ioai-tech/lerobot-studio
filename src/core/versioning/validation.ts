/**
 * Types and helpers for LeRobot dataset format validation (v2.1 / v3.0).
 * Validators run before load; error = cannot parse, warning = issues, info = hints.
 */

export type ValidationLevel = 'error' | 'warning' | 'info';

export type ValidationCategory =
  'file_structure' | 'meta_info' | 'features' | `feature:${string}` | 'episodes';

export interface ValidationItem {
  level: ValidationLevel;
  code?: string;
  message: string;
  // Structured table fields
  category?: ValidationCategory;
  field?: string; // check item label (e.g. "meta/info.json", "fps", "dtype")
  current?: string; // actual value found
  expected?: string; // expected format/value
  suggestion?: string; // how to fix
  // Optional i18n: UI uses code to look up health.validation.codes[code].message / .suggestion
  messageValues?: Record<string, string | number>;
  suggestionValues?: Record<string, string | number>;
}

export interface ValidationReport {
  items: ValidationItem[];
  hasError: boolean;
  hasWarning: boolean;
}

export function createReport(items: ValidationItem[]): ValidationReport {
  const hasError = items.some((i) => i.level === 'error');
  const hasWarning = items.some((i) => i.level === 'warning');
  return { items, hasError, hasWarning };
}

import type { DataSource } from '../datasource/types';
import type { LeRobotInfo } from '../types/lerobot';
import type { MetadataLoadingHelpers } from './types';

/**
 * Abstract base class for LeRobot format validators.
 * Subclass for each codebase version (V2LeRobotValidator, V3LeRobotValidator).
 */
export abstract class BaseLeRobotValidator {
  protected items: ValidationItem[] = [];

  protected push(item: ValidationItem): void {
    this.items.push(item);
  }

  /** Add a passing (info-level) check with structured fields. */
  protected pass(
    category: ValidationCategory,
    field: string,
    current: string,
    expected?: string,
    message = '',
  ): void {
    this.items.push({
      level: 'info',
      message: message || `${field}: ${current}`,
      category,
      field,
      current,
      expected: expected ?? current,
    });
  }

  /** Add a warning check with structured fields. */
  protected warn(
    category: ValidationCategory,
    field: string,
    code: string,
    message: string,
    current: string,
    expected: string,
    suggestion: string,
    messageValues?: Record<string, string | number>,
    suggestionValues?: Record<string, string | number>,
  ): void {
    this.items.push({
      level: 'warning',
      code,
      message,
      category,
      field,
      current,
      expected,
      suggestion,
      messageValues,
      suggestionValues,
    });
  }

  /** Add an error check with structured fields. */
  protected fail(
    category: ValidationCategory,
    field: string,
    code: string,
    message: string,
    current: string,
    expected: string,
    suggestion: string,
    messageValues?: Record<string, string | number>,
    suggestionValues?: Record<string, string | number>,
  ): void {
    this.items.push({
      level: 'error',
      code,
      message,
      category,
      field,
      current,
      expected,
      suggestion,
      messageValues,
      suggestionValues,
    });
  }

  /** Check that a file/directory exists; returns whether it exists. */
  protected reportExists(
    exists: boolean,
    path: string,
    level: 'error' | 'warning',
    code: string,
    suggestion: string,
  ): boolean {
    if (exists) {
      this.pass('file_structure', path, 'Exists', 'Path or file exists');
    } else {
      const method = level === 'error' ? this.fail.bind(this) : this.warn.bind(this);
      method(
        'file_structure',
        path,
        code,
        `${path} does not exist or cannot be read`,
        'Not found',
        'Exists',
        suggestion,
        { path },
      );
    }
    return exists;
  }

  /**
   * Validate a scalar info field.
   * Returns true if valid.
   */
  protected checkScalar(
    value: unknown,
    field: string,
    expected: string,
    condition: (v: unknown) => boolean,
    errorCode: string,
    errorMsg: string,
    suggestion: string,
    level: 'error' | 'warning' = 'error',
  ): boolean {
    const current =
      value === undefined || value === null
        ? 'Missing'
        : typeof value === 'string'
          ? `"${value}"`
          : String(value);
    if (condition(value)) {
      this.pass('meta_info', field, current, expected);
      return true;
    }
    const method = level === 'error' ? this.fail.bind(this) : this.warn.bind(this);
    method('meta_info', field, errorCode, errorMsg, current, expected, suggestion);
    return false;
  }

  /**
   * Validate all features in info.features.
   * Shared between V2 and V3.
   */
  protected validateFeatures(features: Record<string, unknown>): void {
    const VALID_DTYPES = new Set([
      'float32',
      'float64',
      'float16',
      'int8',
      'int16',
      'int32',
      'int64',
      'uint8',
      'uint16',
      'uint32',
      'uint64',
      'bool',
      'image',
      'video',
      'string',
      'language',
      'depth',
    ]);

    const DEFAULT_FEATURE_KEYS = new Set([
      'timestamp',
      'frame_index',
      'episode_index',
      'index',
      'task_index',
    ]);

    // Check for required default features
    for (const key of DEFAULT_FEATURE_KEYS) {
      if (key in features) {
        this.pass('features', `features.${key}`, 'Exists', 'Field exists');
      } else {
        this.warn(
          'features',
          `features.${key}`,
          'DEFAULT_FEATURE_MISSING',
          'Missing system field {{key}}',
          'Not found',
          'Exists',
          'Add "{{key}}" to features in meta/info.json',
          undefined,
          { key },
        );
      }
    }

    // Per-feature validation
    for (const [key, featureRaw] of Object.entries(features)) {
      const cat: ValidationCategory = `feature:${key}`;
      const feature = featureRaw as Record<string, unknown> | null;

      if (!feature || typeof feature !== 'object') {
        this.fail(
          cat,
          `${key}.dtype`,
          'FEATURE_INVALID',
          'features.{{key}} is not a valid object',
          String(featureRaw),
          'Object',
          'Ensure each feature is an object with dtype and shape',
          { key },
        );
        continue;
      }

      // dtype check
      const dtype = feature['dtype'] as string | undefined;
      if (!dtype) {
        this.fail(
          cat,
          `${key}.dtype`,
          'DTYPE_MISSING',
          'features.{{key}}.dtype is missing',
          'Missing',
          'float32 / int64 / video / image / string etc.',
          'Add dtype field (e.g. float32, int64, video, image, string)',
          { key },
        );
      } else if (!VALID_DTYPES.has(dtype)) {
        this.fail(
          cat,
          `${key}.dtype`,
          'DTYPE_INVALID',
          'features.{{key}}.dtype is invalid: {{dtype}}',
          `"${dtype}"`,
          'float32 / int64 / video / image / string etc.',
          'Use a standard dtype',
          { key, dtype },
        );
      } else {
        const expectedDtypeList = Array.from(VALID_DTYPES).join(' | ');
        this.pass(cat, `${key}.dtype`, `"${dtype}"`, `string (${expectedDtypeList})`);
      }

      // shape check
      const shape = feature['shape'] as unknown[] | undefined;
      if (!Array.isArray(shape) || shape.length === 0) {
        this.fail(
          cat,
          `${key}.shape`,
          'SHAPE_INVALID',
          'features.{{key}}.shape must be a non-empty array of positive integers',
          Array.isArray(shape) ? '[]' : 'Missing',
          '[positive integer, ...]',
          'Set shape e.g. [7] or [3, 480, 640]',
          { key },
        );
      } else if (shape.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v <= 0)) {
        this.fail(
          cat,
          `${key}.shape`,
          'SHAPE_INVALID',
          'features.{{key}}.shape must be a non-empty array of positive integers',
          JSON.stringify(shape),
          '[positive integer, ...]',
          'Ensure all dimensions are positive integers',
          { key },
        );
      } else {
        this.pass(cat, `${key}.shape`, JSON.stringify(shape), '[positive integer, ...]');

        // names length check
        const names = feature['names'];
        if (names !== null && names !== undefined) {
          if (!Array.isArray(names)) {
            this.warn(
              cat,
              `${key}.names`,
              'NAMES_INVALID',
              'features.{{key}}.names is not an array',
              String(names),
              'Array or null',
              'Set names to a string array or null',
              { key },
            );
          } else {
            // names should match last dim of shape
            const lastDim = shape[shape.length - 1] as number;
            // flatten if nested
            const flat = (names as unknown[])
              .flat(2)
              .filter((x): x is string => typeof x === 'string');
            if (flat.length > 0 && flat.length !== lastDim) {
              this.warn(
                cat,
                `${key}.names`,
                'NAMES_LENGTH_MISMATCH',
                'features.{{key}}.names length ({{actual}}) does not match shape last dim ({{expected}})',
                String(flat.length),
                String(lastDim),
                'Make names array length equal to shape last dimension',
                { key, actual: flat.length, expected: lastDim },
                { key, expected: lastDim },
              );
            } else {
              this.pass(
                cat,
                `${key}.names`,
                `[${flat.slice(0, 3).join(', ')}${flat.length > 3 ? ', ...' : ''}] (${flat.length})`,
                'string[] (length = shape last dim)',
              );
            }
          }
        }

        // Video-specific checks
        if (dtype === 'video') {
          if (Array.isArray(shape) && shape.length === 3) {
            const [cFirst, , cLast] = shape as [number, number, number];
            const isKnownChannel = (c: number) => c === 1 || c === 3 || c === 4;
            if (!isKnownChannel(cFirst) && !isKnownChannel(cLast)) {
              this.warn(
                cat,
                `${key}.shape`,
                'VIDEO_SHAPE_CHANNELS',
                'Video shape channel count is unusual',
                JSON.stringify(shape),
                '[1|3|4, H, W] or [H, W, 1|3|4]',
                'Typically channels are 3 (RGB); both [C,H,W] and [H,W,C] are supported',
                { key },
              );
            }
          } else if (Array.isArray(shape) && shape.length !== 3) {
            this.warn(
              cat,
              `${key}.shape`,
              'VIDEO_SHAPE_NDIM',
              'Video shape should be 3D (C, H, W), got {{n}}D',
              JSON.stringify(shape),
              '[C, H, W]',
              'Set shape to [C, H, W]',
              { key, n: shape.length },
            );
          }
        }

        // Image-specific checks
        if (dtype === 'image') {
          if (Array.isArray(shape) && shape.length !== 3) {
            this.warn(
              cat,
              `${key}.shape`,
              'IMAGE_SHAPE_NDIM',
              'Image shape should be 3D (C, H, W), got {{n}}D',
              JSON.stringify(shape),
              '[C, H, W]',
              'Set shape to [C, H, W]',
              { key, n: shape.length },
            );
          }
        }
      }
    }
  }

  abstract validate(
    dataSource: DataSource,
    info: LeRobotInfo | null,
    helpers?: MetadataLoadingHelpers,
  ): Promise<ValidationReport>;
}

/** @deprecated Use BaseLeRobotValidator instead */
export type LeRobotFormatValidator = BaseLeRobotValidator;
