import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FULL_ARCHIVE_DOWNLOAD_BYTES,
  preflightRemoteArchive,
  REMOTE_ARCHIVE_PROBE_BYTES,
  translateRemotePreflightFailure,
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

  it('accepts an empty full-download response with no readable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            status: 200,
            headers: { 'content-type': 'application/zip', 'content-length': '0' },
          }),
      ),
    );

    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toEqual({
      ok: true,
      kind: 'zip',
      accessMode: 'full',
      contentLength: 0,
    });
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

  it('uses magic bytes before conflicting response metadata', async () => {
    const { response } = responseWithBody(
      206,
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      {
        'accept-ranges': 'bytes',
        'content-disposition': 'attachment; filename="dataset.tar.gz"',
      },
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
      contentLength: undefined,
    });
  });

  it('ignores invalid content lengths and falls back to the URL extension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            status: 206,
            headers: { 'accept-ranges': 'bytes', 'content-length': 'not-a-number' },
          }),
      ),
    );

    await expect(preflightRemoteArchive('https://example.test/archive.tar.gz')).resolves.toEqual({
      ok: true,
      kind: 'targz',
      accessMode: 'range',
      contentLength: undefined,
    });
  });

  it('recognizes application/gzip and rejects wholly unknown archive content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([0x1f, 0x8b]), {
            status: 206,
            headers: {
              'accept-ranges': 'bytes',
              'content-type': 'application/gzip',
            },
          }),
      ),
    );
    await expect(preflightRemoteArchive('https://example.test/download')).resolves.toEqual({
      ok: true,
      kind: 'targz',
      accessMode: 'range',
      contentLength: undefined,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 206,
            headers: { 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' },
          }),
      ),
    );
    await expect(preflightRemoteArchive('https://example.test/download')).resolves.toEqual({
      ok: false,
      kind: 'unknown',
      failure: {
        code: 'unknown',
        detail: 'Unsupported archive content: expected ZIP, TAR, or TAR.GZ/GZIP.',
      },
    });
  });

  it.each([404, 500])('returns a structured failure for HTTP %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toEqual({
      ok: false,
      kind: 'range',
      failure: { code: 'range_http', actualStatus: status },
    });
  });

  it('rejects 206 responses without range headers and summarizes actual headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            status: 206,
            headers: { 'content-range': 'items 0-1/2', 'accept-ranges': 'none' },
          }),
      ),
    );

    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toMatchObject({
      ok: false,
      kind: 'range',
      failure: {
        code: 'range_headers',
        headerSummary: 'Content-Range: items 0-1/2; Accept-Ranges: none',
      },
    });
  });

  it('accepts Accept-Ranges when Content-Range is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            status: 206,
            headers: { 'accept-ranges': 'BYTES', 'content-type': 'application/x-tar' },
          }),
      ),
    );
    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toEqual({
      ok: true,
      kind: 'tar',
      accessMode: 'range',
      contentLength: undefined,
    });
  });

  it.each([
    ['CORS policy blocked access', 'cors', 'cors'],
    ['Failed to fetch', 'network', 'network'],
    ['socket closed', 'unknown', 'unknown'],
  ] as const)('classifies %s failures as %s', async (message, kind, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(message);
      }),
    );

    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toMatchObject({
      ok: false,
      kind,
      failure: { code, detail: message },
    });
  });

  it('clamps hostile error details and passes stable fallback translation values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`  ${'x'.repeat(300)}  `);
      }),
    );
    const result = await preflightRemoteArchive('https://example.test/archive');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.failure.detail).toHaveLength(221);
    expect(result.failure.detail?.endsWith('…')).toBe(true);

    const translate = vi.fn((_key, fallback, values) =>
      String(fallback).replace('{actualStatus}', String(values?.actualStatus)),
    );
    expect(
      translateRemotePreflightFailure(translate, {
        code: 'range_http',
        actualStatus: 416,
      }),
    ).toContain('416');
    expect(translate).toHaveBeenCalledWith(
      'dialogs.remoteArchive.error.range_http',
      expect.stringContaining('expected HTTP 206'),
      { actualStatus: 416 },
    );
  });

  it('normalizes empty non-Error failures and optional translation fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw '';
      }),
    );
    await expect(preflightRemoteArchive('https://example.test/archive')).resolves.toEqual({
      ok: false,
      kind: 'unknown',
      failure: { code: 'unknown', detail: 'Unknown error' },
    });

    const translate = vi.fn(() => 'translated');
    expect(
      translateRemotePreflightFailure(translate, {
        code: 'range_headers',
        headerSummary: 'Content-Range: (empty); Accept-Ranges: (empty)',
        detail: 'ignored detail',
      }),
    ).toBe('translated');
    expect(translate).toHaveBeenCalledWith(
      'dialogs.remoteArchive.error.range_headers',
      expect.any(String),
      {
        headerSummary: 'Content-Range: (empty); Accept-Ranges: (empty)',
        detail: 'ignored detail',
      },
    );
  });
});
