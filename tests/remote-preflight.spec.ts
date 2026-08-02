import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FULL_ARCHIVE_DOWNLOAD_BYTES,
  preflightRemoteArchive,
  REMOTE_ARCHIVE_PROBE_BYTES,
} from '../src/platform/datasource/remotePreflight';

afterEach(() => {
  vi.unstubAllGlobals();
});

function responseWithBody(
  status: number,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
  close = false,
) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      if (close) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, { status, headers });
  return { response, wasCancelled: () => cancelled };
}

describe('preflightRemoteArchive', () => {
  it('keeps a 206 response on the Range path', async () => {
    const { response, wasCancelled } = responseWithBody(
      206,
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      { 'content-range': 'bytes 0-3/1000', 'content-length': '4' },
      true,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );

    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toEqual({
      ok: true,
      kind: 'zip',
      accessMode: 'range',
      contentLength: 4,
    });
    expect(wasCancelled()).toBe(false);
  });

  it('accepts a 200 response without consuming the complete body', async () => {
    const body = new Uint8Array(REMOTE_ARCHIVE_PROBE_BYTES + 1024);
    body.set([0x1f, 0x8b]);
    const { response, wasCancelled } = responseWithBody(200, body, {
      'content-length': String(body.byteLength),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );

    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toEqual({
      ok: true,
      kind: 'targz',
      accessMode: 'full',
      contentLength: body.byteLength,
    });
    expect(wasCancelled()).toBe(true);
  });

  it('rejects a 200 response whose declared size exceeds the disk safety limit', async () => {
    const { response } = responseWithBody(200, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
      'content-length': String(MAX_FULL_ARCHIVE_DOWNLOAD_BYTES + 1),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );

    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toMatchObject({
      ok: false,
      failure: { code: 'full_download_too_large' },
    });
  });
});
