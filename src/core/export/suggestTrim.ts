import type { NumericalColumnData } from '../loader/types';
import { validateEpisodeTrim, type EpisodeTrimRange } from './trim';

function validateSeconds(fps: number, before: number, after: number) {
  if (
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isFinite(before) ||
    before < 0 ||
    !Number.isFinite(after) ||
    after < 0
  )
    throw new Error('Invalid trim timing');
}

/** Fixed removals always refer to the original episode; round outward to retain partial frames. */
export function fixedTrim(
  length: number,
  fps: number,
  head: number,
  tail: number,
): EpisodeTrimRange {
  validateSeconds(fps, head, tail);
  if (head + tail >= length / fps) throw new Error('Trim would remove the entire episode');
  const range = {
    startFrame: Math.floor(head * fps),
    endFrame: length - Math.floor(tail * fps) - 1,
  };
  validateEpisodeTrim(range, length);
  return range;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

/** Position-like state only. null means there is insufficient evidence to suggest any trim. */
export function suggestTrim(
  data: NumericalColumnData,
  fps: number,
  dimensions: readonly number[],
  before = 3,
  after = 3,
  sensitivity: 'low' | 'medium' | 'high' = 'medium',
): EpisodeTrimRange | null {
  validateSeconds(fps, before, after);
  const { rows, width, values } = data;
  if (
    !Number.isSafeInteger(rows) ||
    rows <= 0 ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    values.length !== rows * width ||
    dimensions.length === 0 ||
    dimensions.some((d) => !Number.isSafeInteger(d) || d < 0 || d >= width)
  )
    return null;
  const blockSize = Math.max(1, Math.round(fps * 0.1));
  const blockCount = Math.ceil(rows / blockSize);
  const lag = Math.max(1, Math.ceil((0.3 * fps) / blockSize));
  if (blockCount < lag + 2) return null;
  const active = new Uint8Array(blockCount);
  const factor = { low: 2, medium: 1, high: 0.5 }[sensitivity];
  if (!factor) throw new Error('Invalid motion sensitivity');
  for (const dimension of new Set(dimensions)) {
    const blocks: number[] = [];
    const residuals: number[] = [];
    const sampleStride = Math.max(1, Math.ceil(rows / 4096));
    let min = Infinity;
    let max = -Infinity;
    for (let start = 0; start < rows; start += blockSize) {
      const samples: number[] = [];
      for (let i = start; i < Math.min(rows, start + blockSize); i++) {
        const value = values[i * width + dimension];
        if (!Number.isFinite(value)) return null;
        samples.push(value);
        if (i > 0 && i < rows - 1 && i % sampleStride === 0) {
          residuals.push(
            Math.abs(
              value -
                (values[(i - 1) * width + dimension] + values[(i + 1) * width + dimension]) / 2,
            ),
          );
        }
      }
      const value = median(samples);
      blocks.push(value);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    // ponytail: heuristic noise floor, not task segmentation; calibrate sensitivity on real recordings.
    const noise = residuals.length ? median(residuals) : 0;
    const threshold =
      factor * Math.max((4 * noise) / Math.sqrt(blockSize), (max - min) * 0.001, 1e-9);
    for (let i = lag; i < blockCount; i++) {
      if (Math.abs(blocks[i] - blocks[i - lag]) > threshold) active[i] = 1;
    }
  }
  let run = 0;
  let reliable = false;
  const required = Math.max(2, Math.ceil((0.2 * fps) / blockSize));
  for (const value of active) {
    run = value ? run + 1 : 0;
    if (run >= required) reliable = true;
  }
  if (!reliable) return null;
  // Preserve all detected edge activity, including brief movements around a sustained action.
  // Include the lag and one block of uncertainty; pauses inside this envelope remain intact.
  const first = Math.max(0, (active.indexOf(1) - lag - 1) * blockSize);
  const endExclusive = Math.min(rows, (active.lastIndexOf(1) + 2) * blockSize);
  const range = {
    startFrame: Math.max(0, Math.floor(first - before * fps)),
    endFrame: Math.min(rows - 1, Math.ceil(endExclusive + after * fps) - 1),
  };
  validateEpisodeTrim(range, rows);
  return range;
}
