import { tableFromIPC } from 'apache-arrow';
import type { LeRobotInfo } from '../types/lerobot';
import type { DataSource } from '../datasource/types';
import type { MetadataLoadingHelpers } from './types';
import { BaseLeRobotValidator, createReport } from './validation';
import { convertArrowValue } from './arrowUtils';
import { classifyLeRobotVersion } from './versionCapability';

const INFO_JSON = 'meta/info.json';
const EPISODES_PARQUET_PATH = 'meta/episodes/chunk-000/file-000.parquet';
const TASKS_JSONL = 'meta/tasks.jsonl';
const TASKS_PARQUET_PATH = 'meta/tasks.parquet';
const DEFAULT_DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const DEFAULT_VIDEO_PATH = 'videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4';

/**
 * Comprehensive validator for LeRobot v3.0 datasets.
 * Checks: file structure, meta/info.json fields, features, episodes consistency.
 */
export class V3FormatValidator extends BaseLeRobotValidator {
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
    const versionCapability = classifyLeRobotVersion(resolvedInfo.codebase_version);
    if (versionCapability.adapterVersion !== 'v3.0') {
      this.fail(
        'meta_info',
        'codebase_version',
        'VERSION_MISMATCH_V3',
        'codebase_version is not supported by the v3.0 reader',
        resolvedInfo.codebase_version ?? 'Missing',
        '"v3.0"',
        'Set codebase_version to v3.0',
      );
      return createReport(this.items);
    }
    if (versionCapability.status === 'read-only') {
      this.warn(
        'meta_info',
        'codebase_version',
        'VERSION_READ_ONLY',
        'This newer v3 version is opened in read-only compatibility mode',
        `"${resolvedInfo.codebase_version}"`,
        '"v3.0" for export',
        'Convert with an official compatible tool before exporting',
      );
    }
    this.pass(
      'meta_info',
      'codebase_version',
      `"${resolvedInfo.codebase_version}"`,
      '"v3.0" or a newer read-only v3 minor',
    );

    const infoV3 = resolvedInfo as LeRobotInfo & {
      data_path?: string;
      video_path?: string;
      splits?: Record<string, string>;
    };

    // ── 3. data_path / video_path template ───────────────────────────────────
    if (infoV3.data_path && infoV3.data_path !== DEFAULT_DATA_PATH) {
      this.warn(
        'meta_info',
        'data_path',
        'DATA_PATH_TEMPLATE',
        'info.data_path does not match default template',
        infoV3.data_path,
        DEFAULT_DATA_PATH,
        'Use default data path template or keep custom path consistent',
      );
    } else if (infoV3.data_path) {
      this.pass('meta_info', 'data_path', infoV3.data_path, DEFAULT_DATA_PATH);
    }

    if (infoV3.video_path != null && infoV3.video_path !== DEFAULT_VIDEO_PATH) {
      this.warn(
        'meta_info',
        'video_path',
        'VIDEO_PATH_TEMPLATE',
        'info.video_path does not match default template',
        infoV3.video_path,
        DEFAULT_VIDEO_PATH,
        'Use default video path template',
      );
    } else if (infoV3.video_path) {
      this.pass('meta_info', 'video_path', infoV3.video_path, DEFAULT_VIDEO_PATH);
    }

    // ── 4. splits (v3 must have train) ──────────────────────────────────────
    if (infoV3.splits != null && typeof infoV3.splits === 'object') {
      if (!('train' in infoV3.splits)) {
        this.warn(
          'meta_info',
          'splits',
          'SPLITS_MISSING_TRAIN',
          'splits must contain "train"',
          JSON.stringify(Object.keys(infoV3.splits)),
          'Object with "train" key',
          'Add splits with at least "train" key',
        );
      } else {
        this.pass('meta_info', 'splits', 'Contains "train"', 'Object with "train" key');
      }
    }

    // ── 5. Meta info fields ─────────────────────────────────────────────────
    this.checkScalar(
      resolvedInfo.robot_type,
      'robot_type',
      'Non-empty string or null',
      (v) => v === null || (typeof v === 'string' && (v as string).trim().length > 0),
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

    // ── 6. features ──────────────────────────────────────────────────────────
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

    // ── 7. meta/episodes (v3 parquet) ────────────────────────────────────────
    let episodesExist = false;
    try {
      episodesExist = await dataSource.exists(EPISODES_PARQUET_PATH);
    } catch {
      // ignore
    }

    if (!episodesExist) {
      this.fail(
        'file_structure',
        EPISODES_PARQUET_PATH,
        'EPISODES_PARQUET_MISSING',
        'meta/episodes first file does not exist',
        'Not found',
        'Exists',
        'Generate meta/episodes/chunk-xxx/file-xxx.parquet per v3 format',
      );
      return createReport(this.items);
    }
    this.pass('file_structure', EPISODES_PARQUET_PATH, 'Exists', 'Path or file exists');

    let episodeCount = 0;
    let episodesTableSchema: { name: string }[] = [];
    let firstEpisodeRow: Record<string, unknown> | null = null;
    if (helpers?.readParquetToIPC) {
      try {
        const ipcBytes = await helpers.readParquetToIPC(EPISODES_PARQUET_PATH);
        const table = tableFromIPC(ipcBytes);
        episodeCount = table.numRows;
        episodesTableSchema = table.schema.fields.map((f) => ({ name: f.name }));
        if (table.numRows > 0) {
          const row: Record<string, unknown> = {};
          table.schema.fields.forEach((field) => {
            const vector = table.getChild(field.name);
            if (vector) row[field.name] = convertArrowValue(vector.get(0));
          });
          firstEpisodeRow = row;
        }
      } catch {
        this.fail(
          'episodes',
          'episodes parquet',
          'EPISODES_PARQUET_INVALID',
          'meta/episodes first file could not be parsed as Parquet',
          'Parse error',
          'Valid Parquet table',
          'Ensure episodes Parquet files are valid',
        );
        return createReport(this.items);
      }
    }

    if (episodeCount === 0) {
      this.warn(
        'episodes',
        'episode count',
        'EPISODES_EMPTY',
        'Episodes table exists but has 0 rows',
        '0',
        '> 0',
        'Populate episodes Parquet files',
      );
    } else {
      this.pass(
        'episodes',
        'episode count',
        String(episodeCount),
        'Positive integer, matches total_episodes',
      );
    }

    // Required columns for v3 episodes
    const requiredEpCols = ['episode_index', 'length', 'dataset_from_index', 'dataset_to_index'];
    const epColSet = new Set(episodesTableSchema.map((f) => f.name));
    const missingEpCols = requiredEpCols.filter((c) => !epColSet.has(c));
    if (missingEpCols.length > 0) {
      this.warn(
        'episodes',
        'episodes parquet columns',
        'PARQUET_MISSING_COLS',
        'Episodes Parquet is missing required columns: ' + missingEpCols.join(', '),
        'Missing: ' + missingEpCols.join(', '),
        requiredEpCols.join(', '),
        'Regenerate episodes Parquet with required columns',
        { cols: missingEpCols.join(', ') },
      );
    } else if (episodesTableSchema.length > 0) {
      this.pass(
        'episodes',
        'episodes parquet columns',
        `All required columns (${episodesTableSchema.length} total)`,
        'episode_index, length, dataset_from_index, dataset_to_index',
      );
    }

    // ── 8. tasks ─────────────────────────────────────────────────────────────
    let hasTasks = false;
    try {
      await dataSource.readText(TASKS_JSONL);
      hasTasks = true;
      this.pass('file_structure', TASKS_JSONL, 'Exists', 'Path or file exists');
    } catch {
      try {
        const tasksExist = await dataSource.exists(TASKS_PARQUET_PATH);
        if (tasksExist) {
          hasTasks = true;
          this.pass('file_structure', TASKS_PARQUET_PATH, 'Exists', 'Path or file exists');
        }
      } catch {
        // ignore
      }
    }
    if (!hasTasks) {
      this.warn(
        'file_structure',
        TASKS_JSONL,
        'TASKS_MISSING',
        'Neither meta/tasks.jsonl nor meta/tasks.parquet found',
        'Not found',
        'Exists',
        'Create tasks.jsonl or tasks.parquet for task metadata',
      );
    }
    if (hasTasks) {
      this.pass('episodes', 'tasks', 'Present', 'tasks.jsonl or tasks.parquet present');
    }

    // ── 9. First data file existence ────────────────────────────────────────
    const firstDataPath = 'data/chunk-000/file-000.parquet';
    try {
      const dataExists = await dataSource.exists(firstDataPath);
      this.reportExists(
        dataExists,
        firstDataPath,
        'warning',
        'DATA_FILE_MISSING',
        'Generate data/chunk-xxx/file-xxx.parquet per v3 format',
      );
    } catch {
      this.warn(
        'file_structure',
        firstDataPath,
        'DATA_FILE_CHECK_FAILED',
        'Could not check if data file exists',
        'Unknown',
        'Exists',
        'Ensure data/chunk-xxx/file-xxx.parquet files exist',
      );
    }

    // ── 10. Video files existence (first episode, all video features) ─────────
    const videoFeatureKeys =
      features && typeof features === 'object'
        ? Object.entries(features as Record<string, { dtype?: string }>)
            .filter(([, f]) => f?.dtype === 'video')
            .map(([k]) => k)
        : [];
    if (videoFeatureKeys.length > 0 && episodeCount > 0 && firstEpisodeRow) {
      const pad3 = (n: number) => String(n).padStart(3, '0');
      for (const featureKey of videoFeatureKeys) {
        const chunk = Number(firstEpisodeRow[`videos/${featureKey}/chunk_index`] ?? 0);
        const file = Number(firstEpisodeRow[`videos/${featureKey}/file_index`] ?? 0);
        const videoPath = `videos/${featureKey}/chunk-${pad3(chunk)}/file-${pad3(file)}.mp4`;
        try {
          const videoExists = await dataSource.exists(videoPath);
          this.reportExists(
            videoExists,
            videoPath,
            'warning',
            'VIDEO_FILE_MISSING',
            'Generate video files per v3 format: videos/<key>/chunk-xxx/file-xxx.mp4',
          );
        } catch {
          this.warn(
            'file_structure',
            videoPath,
            'VIDEO_FILE_CHECK_FAILED',
            'Could not check if video file exists',
            'Unknown',
            'Path or file exists',
            'Ensure videos/<key>/chunk-xxx/file-xxx.mp4 exist',
          );
        }
      }
    }

    return createReport(this.items);
  }
}
