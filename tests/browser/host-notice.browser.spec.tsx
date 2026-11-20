import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/core';
import { HostChrome } from '@/components/Host/HostChrome';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('a notice in a 260 px sidebar keeps its text in full lines, its action below (s10 F-11)', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:260px';
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <I18nProvider forcedLanguage="en">
          <HostChrome
            extensions={[
              {
                id: 'host',
                notices: [
                  {
                    id: 'versions',
                    severity: 'info',
                    text: 'Edits apply to the versions you create next. Existing versions do not change.',
                    action: { label: 'Got it', onSelect: () => undefined },
                  },
                ],
              },
            ]}
          />
        </I18nProvider>,
      ),
    );
    const notice = host.querySelector<HTMLElement>('[data-host-notice="versions"]')!;
    const text = notice.querySelector<HTMLElement>('[data-host-notice-text]')!;
    const action = notice.querySelector<HTMLElement>('button')!;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 16;
    // The text takes the notice's width (beside the icon), so 80 characters fit in
    // three lines, not one word per line.
    expect(text.getBoundingClientRect().width).toBeGreaterThan(
      notice.getBoundingClientRect().width * 0.7,
    );
    expect(text.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight * 3 + 1);
    // The action sits under the text, aligned with it.
    expect(action.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      text.getBoundingClientRect().bottom - 0.5,
    );
    expect(
      Math.abs(action.getBoundingClientRect().left - text.getBoundingClientRect().left),
    ).toBeLessThan(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
