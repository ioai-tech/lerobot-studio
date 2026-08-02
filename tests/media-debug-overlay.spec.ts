import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MediaDebugOverlay } from '../packages/react/src/components/panels/Common/MediaDebugOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('MediaDebugOverlay', () => {
  it('renders hover-only overlay classes and metadata rows', () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        'div',
        { className: 'group' },
        React.createElement(MediaDebugOverlay, {
          featureKey: 'observation.images.cam',
          translationPrefix: 'panels.video.debug',
          metadata: {
            dtype: 'video',
            shapeText: '[480, 640, 3]',
            fps: 30,
            width: 1280,
            height: 720,
            codec: 'h264',
            pixelFormat: 'yuv420p',
            channels: 3,
            hasAudio: false,
            timeline: {
              startSec: 0,
              endSec: 1.5,
            },
          },
        }),
      ),
    );

    expect(markup).toContain('group-hover:opacity-100');
    expect(markup).toContain('observation.images.cam');
    expect(markup).toContain('1280 x 720');
    expect(markup).toContain('h264');
    expect(markup).toContain('0.00s - 1.50s');
  });
});
