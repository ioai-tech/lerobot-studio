import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LeRobotViewer, type LeRobotViewerError } from '@/public-api';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

// Its own file: a page policy cannot be lifted once set.
it('names a page CSP that refuses the workers, instead of loading forever', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "worker-src 'none'";
  document.head.prepend(policy);
  await page.viewport(1280, 800);
  const host = document.createElement('div');
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  const errors: LeRobotViewerError[] = [];
  const root = createRoot(host);
  try {
    root.render(
      <LeRobotViewer
        dataSource={new FetchDataSource(FRAME_CODED)}
        language="en"
        onFatalError={(error) => errors.push(error)}
      />,
    );
    await expect.poll(() => errors.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(errors[0].code).toBe('PARQUET_ENGINE_UNAVAILABLE');
    expect(errors[0].message).toMatch(/worker (script could not load|could not start)/);
  } finally {
    root.unmount();
    host.remove();
  }
}, 60_000);
