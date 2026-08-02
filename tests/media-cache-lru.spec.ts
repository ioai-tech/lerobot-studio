import { describe, expect, it, vi } from 'vitest';
import { LRUCache, VideoUrlCache } from '@ioai/lerobot-studio-platform';

describe('LRUCache ownsUrls', () => {
  it('does not revoke blob URLs when ownsUrls is false', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const cache = new LRUCache<string, string>(2, false);
    cache.set('a', 'blob:a');
    cache.set('b', 'blob:b');
    cache.set('c', 'blob:c'); // evicts oldest 'a'
    expect(revoke).not.toHaveBeenCalled();
    revoke.mockRestore();
  });

  it('revokes blob URLs on eviction when ownsUrls is true', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const cache = new LRUCache<string, string>(2, true);
    cache.set('a', 'blob:a');
    cache.set('b', 'blob:b');
    cache.set('c', 'blob:c');
    expect(revoke).toHaveBeenCalled();
    revoke.mockRestore();
  });

  it('delete does not revoke when ownsUrls is false', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const cache = new LRUCache<string, string>(10, false);
    cache.set('x', 'blob:x');
    cache.delete('x');
    expect(revoke).not.toHaveBeenCalled();
    revoke.mockRestore();
  });
});

describe('VideoUrlCache', () => {
  it('invalidate removes path without revoking (ownership at DataSource)', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const v = new VideoUrlCache(10);
    v.getUrl('p1', 'blob:fake1');
    expect(v.get('p1')).toBe('blob:fake1');
    v.invalidate('p1');
    expect(v.get('p1')).toBeUndefined();
    expect(revoke).not.toHaveBeenCalled();
    revoke.mockRestore();
  });
});
