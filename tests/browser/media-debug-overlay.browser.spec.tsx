import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { I18nProvider } from '@/i18n/core';
import { MediaDebugOverlay } from '@/components/panels/Common/MediaDebugOverlay';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('a debug overlay longer than its panel scrolls with the pointer once shown, and lets clicks through while hidden', async () => {
  const host = document.createElement('div');
  // A short panel: the overlay's rows need more than its 50% height.
  host.style.cssText = 'width:320px;height:120px';
  document.body.append(host);
  const root = createRoot(host);
  let panelClicks = 0;
  try {
    await act(async () =>
      root.render(
        <I18nProvider forcedLanguage="en">
          <div
            className="group relative h-full w-full bg-black"
            data-testid="panel"
            onClick={() => (panelClicks += 1)}
          >
            <MediaDebugOverlay
              translationPrefix="panels.image.debug"
              featureKey="observation.images.camera_head_left"
              metadata={{
                dtype: 'image',
                shapeText: '[1536, 2048, 3]',
                fps: 30,
                width: 2048,
                height: 1536,
                codec: 'av1',
                pixelFormat: 'yuv420p',
                channels: 3,
                hasAudio: false,
                timeline: { startSec: 0, endSec: 65.07 },
              }}
            />
          </div>
        </I18nProvider>,
      ),
    );
    const overlay = host.querySelector<HTMLElement>('[data-testid="media-debug-overlay"]')!;
    const panel = host.querySelector<HTMLElement>('[data-testid="panel"]')!;
    expect(overlay.scrollHeight).toBeGreaterThan(overlay.clientHeight);
    const centre = () => {
      const box = overlay.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };

    // Hidden: the point under the overlay belongs to the panel.
    expect(getComputedStyle(overlay).pointerEvents).toBe('none');
    const hidden = centre();
    expect(overlay.contains(document.elementFromPoint(hidden.x, hidden.y))).toBe(false);

    // A real pointer arms and shows it (the panel is hovered).
    await page.elementLocator(panel).hover({ position: { x: 300, y: 110 } });
    await page.elementLocator(panel).hover({ position: { x: 20, y: 20 } });
    await expect.poll(() => getComputedStyle(overlay).opacity).toBe('1');
    expect(getComputedStyle(overlay).pointerEvents).toBe('auto');
    const shown = centre();
    expect(overlay.contains(document.elementFromPoint(shown.x, shown.y))).toBe(true);
    expect(getComputedStyle(overlay).overscrollBehaviorY).toBe('contain');
    // It scrolls to its last row.
    overlay.scrollTop = overlay.scrollHeight;
    expect(overlay.scrollTop).toBeGreaterThan(0);
    expect(overlay.scrollTop + overlay.clientHeight).toBeGreaterThanOrEqual(
      overlay.scrollHeight - 1,
    );
    expect(panelClicks).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
