/**
 * Arrow value conversion for versioning (e.g. parsing v3 Parquet episode/task tables).
 */

function tryParseJsonString(str: string): unknown {
  const trimmed = str.trim();
  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return str;
    }
  }
  return str;
}

export function convertArrowValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') {
    const converted = Number(val);
    if (!Number.isSafeInteger(converted)) {
      throw new RangeError(
        `Parquet int64 value is outside JavaScript's safe integer range: ${val}`,
      );
    }
    return converted;
  }
  if (typeof val === 'string') return tryParseJsonString(val);
  if (typeof val !== 'object') return val;

  const obj = val as {
    constructor: { name: string };
    toArray?: () => unknown[];
    toString?: () => string;
  };
  if (obj.constructor.name.includes('Array') || 'toArray' in obj) {
    return Array.from(val as Iterable<unknown>).map((item) => convertArrowValue(item));
  }
  if (
    obj.constructor.name.includes('Text') ||
    obj.constructor.name.includes('Utf8') ||
    obj.constructor.name.includes('String')
  ) {
    return tryParseJsonString(String(val));
  }
  if (typeof obj.toString === 'function') {
    const str = obj.toString();
    if (str !== '[object Object]') return tryParseJsonString(str);
  }
  return val;
}

/** Column names to try for task description in tasks.parquet (e.g. __index_level_0__ from pandas). */
export const TASK_DESCRIPTION_COLUMN_CANDIDATES = [
  'task',
  '__index_level_0__',
  'tasks',
  'task_name',
  'task_id',
  'name',
] as const;

/**
 * Normalize a raw task value to a single display string.
 * Handles: null/undefined, plain string, JSON array string (e.g. "[\"pick and place\"]"), Array.
 */
export function normalizeTaskDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const arr = JSON.parse(trimmed) as unknown[];
        if (Array.isArray(arr) && arr.length > 0) {
          const parts = arr.map((x) => (x != null ? String(x).trim() : '')).filter(Boolean);
          return parts.join('; ');
        }
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value.map((x) => (x != null ? String(x).trim() : '')).filter(Boolean);
    return parts.length > 0 ? parts.join('; ') : '';
  }
  return String(value);
}
