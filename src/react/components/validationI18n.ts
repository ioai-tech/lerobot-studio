/**
 * Shared i18n helpers for validation report display (table + CSV export).
 * Maps validator output terms (e.g. "Exists", "Missing") to health.validation.terms keys.
 */

const TERM_KEYS: Record<string, string> = {
  存在: 'health.validation.terms.exists',
  Exists: 'health.validation.terms.exists',
  缺失: 'health.validation.terms.missing',
  Missing: 'health.validation.terms.missing',
  不存在: 'health.validation.terms.notExists',
  'Not found': 'health.validation.terms.notExists',
  '无效 JSON': 'health.validation.terms.invalidJson',
  'Invalid JSON': 'health.validation.terms.invalidJson',
  '合法 JSON 文件': 'health.validation.terms.validJson',
  'Valid JSON file': 'health.validation.terms.validJson',
  正整数: 'health.validation.terms.positiveInteger',
  'Positive integer': 'health.validation.terms.positiveInteger',
  非负整数: 'health.validation.terms.nonNegativeInteger',
  'Non-negative integer': 'health.validation.terms.nonNegativeInteger',
  正数: 'health.validation.terms.positiveNumber',
  'Positive number': 'health.validation.terms.positiveNumber',
  未知: 'health.validation.terms.unknown',
  Unknown: 'health.validation.terms.unknown',
  'Non-empty string': 'health.validation.terms.nonEmptyString',
  非空字符串: 'health.validation.terms.nonEmptyString',
  Present: 'health.validation.terms.present',
  路径或文件存在: 'health.validation.terms.pathOrFileExists',
  'Path or file exists': 'health.validation.terms.pathOrFileExists',
  字段存在: 'health.validation.terms.fieldExists',
  'Field exists': 'health.validation.terms.fieldExists',
  '[正整数, ...]': 'health.validation.terms.positiveIntArray',
  '[positive integer, ...]': 'health.validation.terms.positiveIntArray',
  'string[]（长度=shape 末维）': 'health.validation.terms.stringArrayMatchShape',
  'string[] (length = shape last dim)': 'health.validation.terms.stringArrayMatchShape',
  '含至少一个 feature 的对象': 'health.validation.terms.objectWithFeatures',
  'Object with at least one feature': 'health.validation.terms.objectWithFeatures',
  '正整数，与 total_episodes 一致': 'health.validation.terms.positiveIntMatchTotalEpisodes',
  'Positive integer, matches total_episodes':
    'health.validation.terms.positiveIntMatchTotalEpisodes',
  '每个 episode 的 length > 0': 'health.validation.terms.episodeLengthPositive',
  'Each episode length > 0': 'health.validation.terms.episodeLengthPositive',
  'All episode length > 0': 'health.validation.terms.episodeLengthPositive',
  '非负整数（条数）': 'health.validation.terms.nonNegativeIntCount',
  'Non-negative integer (count)': 'health.validation.terms.nonNegativeIntCount',
  '包含 frame_index, episode_index, index, timestamp 等必要列':
    'health.validation.terms.requiredParquetColumns',
  'Object with "train" key': 'health.validation.terms.objectWithTrainKey',
  'Contains "train"': 'health.validation.terms.containsTrain',
  'episode_index, length, dataset_from_index, dataset_to_index':
    'health.validation.terms.requiredEpisodesColumns',
  'tasks.jsonl or tasks.parquet present': 'health.validation.terms.tasksPresent',
  Object: 'health.validation.terms.object',
  'Array or null': 'health.validation.terms.arrayOrNull',
};

export function translateTerm(
  t: (key: string, defaultOrOptions?: string | Record<string, unknown>) => string,
  value: string | undefined,
): string {
  if (value == null || value === '') return value ?? '';
  const key = TERM_KEYS[value];
  return key ? t(key, value) : value;
}
