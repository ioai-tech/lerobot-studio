import type { LeRobotInfo } from '../types/lerobot';
import type { DataSource } from '../datasource/types';
import type { MetadataLoadingHelpers } from './types';
import { BaseLeRobotValidator, createReport } from './validation';

const INFO_JSON = 'meta/info.json';
const EPISODES_JSONL = 'meta/episodes.jsonl';
const TASKS_JSONL = 'meta/tasks.jsonl';

/**
 * Comprehensive validator for LeRobot v2.0 / v2.1 datasets.
 * Checks: file structure, meta/info.json fields, features, episodes consistency.
 */
export class V2FormatValidator extends BaseLeRobotValidator {
  async validate(
    dataSource: DataSource,
    info: LeRobotInfo | null,
    helpers?: MetadataLoadingHelpers,
  ): Promise<ReturnType<typeof createReport>> {
    this.items = [];

    // ── 1. meta/info.json ────────────────────────────────────────────────────
    let resolvedInfo = info;
    if (!resolvedInfo) {
      let infoText: string;
      try {
        infoText = await dataSource.readText(INFO_JSON);
      } catch {
        this.fail(
          'file_structure',
          INFO_JSON,
          'INFO_MISSING',
          'meta/info.json does not exist or cannot be read',
          'Not found',
          'Exists',
          'Ensure the current directory is the LeRobot dataset root and meta/info.json exists',
        );
        return createReport(this.items);
      }
      try {
        resolvedInfo = JSON.parse(infoText) as LeRobotInfo;
        this.pass('file_structure', INFO_JSON, 'Exists', 'Path or file exists');
      } catch {
        this.fail(
          'file_structure',
          INFO_JSON,
          'INFO_PARSE_ERROR',
          'meta/info.json JSON parse failed',
          'Invalid JSON',
          'Valid JSON file',
          'Check JSON syntax, e.g. at https://jsonlint.com',
        );
        return createReport(this.items);
      }
    } else {
      this.pass('file_structure', INFO_JSON, 'Exists', 'Path or file exists');
    }

    // ── 2. codebase_version ─────────────────────────────────────────────────
    const ver = (resolvedInfo.codebase_version || '').trim().toLowerCase();
    if (!ver.startsWith('v2')) {
      this.fail(
        'meta_info',
        'codebase_version',
        'VERSION_MISMATCH',
        'codebase_version is not v2.x',
        resolvedInfo.codebase_version ?? 'Missing',
        '"v2.0" or "v2.1"',
        'If this is v3.0, use the correct loader; otherwise set codebase_version to v2.0 or v2.1',
      );
      return createReport(this.items);
    }
    this.pass(
      'meta_info',
      'codebase_version',
      `"${resolvedInfo.codebase_version}"`,
      '"v2.0" or "v2.1"',
    );

    // ── 3. Meta info fields ──────────────────────────────────────────────────
    this.checkScalar(
      resolvedInfo.robot_type,
      'robot_type',
      'Non-empty string',
      (v) => typeof v === 'string' && (v as string).trim().length > 0,
      'ROBOT_TYPE_MISSING',
      'robot_type is missing or empty',
      'Set robot type, e.g. "so100" or "lekiwi"',
      'warning',
    );

    this.checkScalar(
      resolvedInfo.total_episodes,
      'total_episodes',
      'Positive integer',
      (v) => typeof v === 'number' && Number.isInteger(v) && v > 0,
      'TOTAL_EPISODES_INVALID',
      'total_episodes must be a positive integer',
      'Set correct total episode count',
    );

    this.checkScalar(
      resolvedInfo.total_frames,
      'total_frames',
      'Positive integer',
      (v) => typeof v === 'number' && Number.isInteger(v) && v > 0,
      'TOTAL_FRAMES_INVALID',
      'total_frames must be a positive integer',
      'Set correct total frame count',
    );

    this.checkScalar(
      resolvedInfo.total_tasks,
      'total_tasks',
      'Non-negative integer',
      (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      'TOTAL_TASKS_INVALID',
      'total_tasks must be a non-negative integer',
      'Set correct total task count (may be 0)',
      'warning',
    );

    this.checkScalar(
      resolvedInfo.fps,
      'fps',
      'Positive number',
      (v) => typeof v === 'number' && v > 0,
      'FPS_INVALID',
      'fps must be a positive number',
      'Set correct FPS, e.g. 30',
    );

    const chunksSize = (resolvedInfo as { chunks_size?: unknown }).chunks_size;
    this.checkScalar(
      chunksSize,
      'chunks_size',
      'Positive integer',
      (v) => typeof v === 'number' && Number.isInteger(v) && v > 0,
      'CHUNKS_SIZE_MISSING',
      'chunks_size is missing; default 1000 will be used',
      'Add chunks_size field, recommended 1000',
      'warning',
    );

    // ── 4. features object ──────────────────────────────────────────────────
    const features = resolvedInfo.features;
    if (!features || typeof features !== 'object' || Object.keys(features).length === 0) {
      this.fail(
        'meta_info',
        'features',
        'FEATURES_EMPTY',
        'features is missing or empty',
        features == null ? 'Missing' : '{}',
        'Object with at least one feature',
        'Add features in info.json defining all dataset columns',
      );
    } else {
      this.pass(
        'meta_info',
        'features',
        `${Object.keys(features).length} feature(s)`,
        'Object with at least one feature',
      );
      this.validateFeatures(features as Record<string, unknown>);
    }

    // ── 5. meta/episodes.jsonl ──────────────────────────────────────────────
    let episodesJsonlText: string;
    try {
      episodesJsonlText = await dataSource.readText(EPISODES_JSONL);
      this.pass('file_structure', EPISODES_JSONL, 'Exists', 'Path or file exists');
    } catch {
      this.fail(
        'file_structure',
        EPISODES_JSONL,
        'EPISODES_MISSING',
        'meta/episodes.jsonl does not exist or cannot be read',
        'Not found',
        'Exists',
        'Create meta/episodes.jsonl with one JSON object per line per episode',
      );
      return createReport(this.items);
    }

    // ── 6. Parse episodes.jsonl ─────────────────────────────────────────────
    const episodeLines = episodesJsonlText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const episodes: { episode_index?: number; length?: number; num_frames?: number }[] = [];
    let parseError = false;
    for (const line of episodeLines) {
      try {
        episodes.push(JSON.parse(line));
      } catch {
        this.fail(
          'episodes',
          'episodes.jsonl line format',
          'EPISODES_INVALID_JSONL',
          'A line in episodes.jsonl failed to parse as JSON',
          'Invalid JSON line',
          'Valid JSON object (one per line)',
          'Ensure each line is a valid JSON object',
        );
        parseError = true;
        break;
      }
    }
    if (parseError) return createReport(this.items);

    // Episode count
    const parsedCount = episodes.length;
    const expectedCount = resolvedInfo.total_episodes ?? 0;
    if (parsedCount === 0) {
      this.warn(
        'episodes',
        'episode count',
        'EPISODES_EMPTY',
        'episodes.jsonl parsed but is empty',
        '0',
        `${expectedCount} (total_episodes)`,
        'Check that episodes.jsonl is populated',
      );
    } else if (expectedCount > 0 && parsedCount !== expectedCount) {
      this.warn(
        'episodes',
        'episode count',
        'EPISODES_COUNT_MISMATCH',
        'Parsed episode count ({{parsed}}) does not match total_episodes ({{expected}})',
        String(parsedCount),
        String(expectedCount),
        'Regenerate episodes.jsonl or fix total_episodes in info.json',
        { parsed: parsedCount, expected: expectedCount },
        { expected: expectedCount },
      );
    } else {
      this.pass(
        'episodes',
        'episode count',
        String(parsedCount),
        'Positive integer, matches total_episodes',
      );
    }

    // Check episode fields
    const zeroLength = episodes.filter((ep) => {
      const len = ep.length ?? ep.num_frames ?? 0;
      return len === 0;
    });
    if (zeroLength.length > 0) {
      this.warn(
        'episodes',
        'episode length',
        'ZERO_LENGTH_EPISODES',
        '{{count}} episode(s) have length 0',
        `${zeroLength.length} episode(s) length=0`,
        'All episode length > 0',
        'Regenerate episodes.jsonl so each episode has a positive frame count',
        { count: zeroLength.length },
        { count: zeroLength.length },
      );
    } else if (episodes.length > 0) {
      this.pass('episodes', 'episode length', 'All episode length > 0', 'Each episode length > 0');
    }

    // Check missing length field
    const noLength = episodes.filter((ep) => ep.length == null && ep.num_frames == null);
    if (noLength.length > 0) {
      this.warn(
        'episodes',
        'episode.length field',
        'EPISODES_NO_LENGTH',
        '{{count}} episode(s) lack length/num_frames',
        `${noLength.length} episode(s) missing`,
        'Each episode has length field',
        'Add "length" to each line in episodes.jsonl',
        { count: noLength.length },
        { count: noLength.length },
      );
    }

    // ── 7. meta/tasks.jsonl ─────────────────────────────────────────────────
    let taskCount = 0;
    try {
      const tasksText = await dataSource.readText(TASKS_JSONL);
      this.pass('file_structure', TASKS_JSONL, 'Exists', 'Path or file exists');
      const taskLines = tasksText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of taskLines) {
        try {
          JSON.parse(line);
          taskCount += 1;
        } catch {
          // ignore malformed lines for count
        }
      }
    } catch {
      this.warn(
        'file_structure',
        TASKS_JSONL,
        'TASKS_MISSING',
        'meta/tasks.jsonl does not exist or is empty',
        'Not found',
        'Exists',
        'Create tasks.jsonl with one JSON per line: {"task_index": 0, "task": "description"}',
      );
    }

    if (taskCount > 0) {
      this.pass('episodes', 'task count', `${taskCount} task(s)`, 'Non-negative integer (count)');
    }

    // ── 8. Data file existence (first episode) ──────────────────────────────
    const chunksVal = typeof chunksSize === 'number' && chunksSize > 0 ? chunksSize : 1000;
    const firstEpisodeIdx = 0;
    const chunkIdx = Math.floor(firstEpisodeIdx / chunksVal);
    const firstDataPath = `data/chunk-${String(chunkIdx).padStart(3, '0')}/episode_${String(firstEpisodeIdx).padStart(6, '0')}.parquet`;
    try {
      const exists = await dataSource.exists(firstDataPath);
      this.reportExists(
        exists,
        firstDataPath,
        'warning',
        'DATA_FILE_MISSING',
        'Generate Parquet data files under data/ per v2 format',
      );
    } catch {
      this.warn(
        'file_structure',
        firstDataPath,
        'DATA_FILE_CHECK_FAILED',
        'Could not check if data file exists',
        'Unknown',
        'Exists',
        'Ensure data/chunk-xxx/episode_xxxxxx.parquet files exist',
      );
    }

    // ── 9. Video files existence (if video features exist) ──────────────────
    if (features && typeof features === 'object') {
      const videoFeatures = Object.entries(features as Record<string, { dtype?: string }>)
        .filter(([, f]) => f?.dtype === 'video')
        .map(([k]) => k);

      for (const key of videoFeatures) {
        const videoPath = `videos/chunk-${String(chunkIdx).padStart(3, '0')}/${key}/episode_${String(firstEpisodeIdx).padStart(6, '0')}.mp4`;
        try {
          const exists = await dataSource.exists(videoPath);
          this.reportExists(
            exists,
            videoPath,
            'warning',
            'VIDEO_FILE_MISSING',
            'Generate video files: videos/chunk-xxx/<key>/episode_xxxxxx.mp4',
          );
        } catch {
          this.warn(
            'file_structure',
            videoPath,
            'VIDEO_FILE_CHECK_FAILED',
            'Could not check if video file exists',
            'Unknown',
            'Exists',
            'Ensure videos/chunk-xxx/<key>/episode_xxxxxx.mp4 exist',
          );
        }
      }
    }

    // ── 10. Avoid eager data parquet reads during metadata validation ─────────
    // Column-level validation is intentionally deferred to parser/runtime reads
    // so that opening a large v2 dataset stays metadata-only.
    void helpers;

    return createReport(this.items);
  }
}
