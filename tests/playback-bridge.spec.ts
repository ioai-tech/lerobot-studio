import { describe, expect, it, vi } from 'vitest';
import { PendingPlaybackIntent } from '../src/react/contexts/usePlaybackBridge';

describe('PendingPlaybackIntent', () => {
  it('applies the latest explicit target before queued toggles', () => {
    const intent = new PendingPlaybackIntent();
    const set = vi.fn();
    const toggle = vi.fn();

    intent.requestToggle();
    intent.requestSet(true);
    intent.flush(set, toggle);

    expect(set).toHaveBeenCalledWith(true);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('coalesces an even number of toggles and applies an odd toggle once', () => {
    const intent = new PendingPlaybackIntent();
    const toggle = vi.fn();

    intent.requestToggle();
    intent.requestToggle();
    intent.flush(vi.fn(), toggle);
    expect(toggle).not.toHaveBeenCalled();

    intent.requestToggle();
    intent.flush(vi.fn(), toggle);
    intent.flush(vi.fn(), toggle);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('clears older toggle intent when an explicit target is flushed', () => {
    const intent = new PendingPlaybackIntent();
    const toggle = vi.fn();

    intent.requestToggle();
    intent.requestSet(false);
    intent.flush(vi.fn(), toggle);
    intent.flush(vi.fn(), toggle);

    expect(toggle).not.toHaveBeenCalled();
  });
});
