import { describe, expect, it } from 'vitest';
import { cameraPreload } from '../src/react/services/cameraPreload';

describe('cameraPreload', () => {
  it('reads ahead only while playing with the episode loaded', () => {
    expect(cameraPreload({ loading: false, playing: true })).toBe('auto');
  });
  it('a paused camera reads only what its frame needs', () => {
    expect(cameraPreload({ loading: false, playing: false })).toBe('metadata');
  });
  it('a loading episode keeps every camera to its first frame', () => {
    expect(cameraPreload({ loading: true, playing: true })).toBe('metadata');
    expect(cameraPreload({ loading: true, playing: false })).toBe('metadata');
  });
});
