import { describe, expect, it } from 'vitest';
import { getDatasetDisplayName } from '../packages/core/src/utils/datasetDisplayName';

describe('getDatasetDisplayName', () => {
  it('prefers the explicit label and safely derives a decoded path name', () => {
    expect(getDatasetDisplayName({ data_path: 'data/demo.parquet' } as any, 'Chosen')).toBe(
      'Chosen',
    );
    expect(getDatasetDisplayName({ data_path: 'data/my%2520dataset.parquet' } as any)).toBe(
      'my dataset.parquet',
    );
    expect(getDatasetDisplayName({ video_path: 'videos\\camera.mp4' } as any)).toBe('camera.mp4');
  });

  it('does not expose file templates or malformed encoded path names', () => {
    expect(getDatasetDisplayName(null)).toBeUndefined();
    expect(getDatasetDisplayName({ data_path: '' } as any)).toBeUndefined();
    expect(getDatasetDisplayName({ data_path: '////' } as any)).toBeUndefined();
    expect(
      getDatasetDisplayName({ data_path: 'data/file-{file_index:03d}.parquet' } as any),
    ).toBeUndefined();
    expect(getDatasetDisplayName({ data_path: 'data/%E0%A4%A' } as any)).toBe('%E0%A4%A');
  });
});
