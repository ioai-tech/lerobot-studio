import { describe, expect, it } from 'vitest';
import { detectImageColumns, isImageColumnName } from '@/core';

describe('parquet image column detection', () => {
  it('recognizes single observation.image column', () => {
    expect(isImageColumnName('observation.image')).toBe(true);
  });

  it('recognizes observation.images.* columns', () => {
    expect(isImageColumnName('observation.images.cam_high')).toBe(true);
    expect(isImageColumnName('observation.images.side')).toBe(true);
  });

  it('filters image columns from mixed schema', () => {
    const columns = ['timestamp', 'observation.image', 'observation.images.cam_high', 'action'];
    expect(detectImageColumns(columns)).toEqual([
      'observation.image',
      'observation.images.cam_high',
    ]);
  });

  it('does not match non-image columns', () => {
    expect(isImageColumnName('observation.state')).toBe(false);
    expect(isImageColumnName('images.camera')).toBe(false);
  });
});
