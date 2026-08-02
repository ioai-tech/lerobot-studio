import { describe, expect, it } from 'vitest';
import {
  buildFileUrl,
  buildFolderUrl,
  buildHistoryIdsFromParsed,
  parseSourceUrl,
} from '../apps/web/src/utils/sourceUrl';

describe('sourceUrl local encoding', () => {
  it('does not double-encode path separators in file names', () => {
    const url = buildFileUrl('lerobot_io-ai-data/lerobot_dataset.tar.gz');
    expect(url).toBe('file://lerobot_io-ai-data%2Flerobot_dataset.tar.gz');
    expect(url).not.toContain('%252F');
  });

  it('normalizes already-encoded labels before building url', () => {
    const url = buildFileUrl('lerobot_io-ai-data%2Flerobot_dataset.tar.gz');
    expect(url).toBe('file://lerobot_io-ai-data%2Flerobot_dataset.tar.gz');
  });

  it('matches IDB key when URLSearchParams decoded slashes in raw url', () => {
    const parsed = parseSourceUrl('file://lerobot_io-ai-data/lerobot_dataset.tar.gz');
    const ids = buildHistoryIdsFromParsed(parsed);
    expect(ids).toContain('localArchive:file://lerobot_io-ai-data%2Flerobot_dataset.tar.gz');
  });

  it('matches legacy double-encoded IDB keys', () => {
    const parsed = parseSourceUrl('file://lerobot_io-ai-data%2Fdata.tar.gz');
    const ids = buildHistoryIdsFromParsed(parsed);
    expect(ids).toContain('localArchive:file://lerobot_io-ai-data%252Fdata.tar.gz');
  });

  it('builds folder url with normalized spaces', () => {
    expect(buildFolderUrl('lerobot_dataset 11')).toBe('folder://lerobot_dataset%2011');
  });
});
