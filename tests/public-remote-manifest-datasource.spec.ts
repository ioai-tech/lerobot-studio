import { describe, expect, it } from 'vitest';
import { createRemoteManifestDataSource } from '../src/react/public-api';

describe('createRemoteManifestDataSource', () => {
  it('exposes listPaths and getObjectUrl for host-signed files', async () => {
    const source = createRemoteManifestDataSource([
      {
        logicalPath: './videos/cam.mp4',
        presignedUrl: 'https://cdn.example.test/cam.mp4?sig=1',
        contentType: 'video/mp4',
        sizeBytes: 1024,
      },
      {
        logicalPath: 'meta/info.json',
        presignedUrl: 'https://cdn.example.test/info.json?sig=1',
      },
    ]);

    await expect(source.exists('videos/cam.mp4')).resolves.toBe(true);
    await expect(source.listPaths?.()).resolves.toEqual(['videos/cam.mp4', 'meta/info.json']);
    await expect(source.getObjectUrl('videos/cam.mp4')).resolves.toBe(
      'https://cdn.example.test/cam.mp4?sig=1',
    );
  });
});
