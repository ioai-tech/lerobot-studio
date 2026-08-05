export interface SampleDataset {
  id: string;
  name: string;
  description: string;
  url?: string; // 保留向后兼容
  version?: 'v2' | 'v3';
  // 新增字段
  title?: string; // 标题文字（优先使用，否则用 name）
  coverImageUrl?: string; // 封面图像 URL
  previewVideoUrl?: string; // 预览视频 URL
  archiveUrl?: string; // tar/zip 包链接（优先使用，否则用 url）
}

// 获取实际使用的归档 URL
export function getArchiveUrl(sample: SampleDataset): string {
  return sample.archiveUrl || sample.url || '';
}

export interface SampleDatasetsManifestV1 {
  schemaVersion: 1;
  generatedAt?: string;
  /** 可选：用于拼接 archive/cover 等相对路径 */
  baseUrl?: string;
  datasets: Array<{
    id: string;
    title?: string;
    name?: string;
    description?: string;
    version?: 'v2' | 'v3';
    archiveUrl?: string;
    archiveFile?: string;
    coverImageUrl?: string;
    coverImageFile?: string;
    previewVideoUrl?: string;
  }>;
}

function getManifestUrlFromEnv(): string | null {
  const fromEnv = (import.meta as any).env?.VITE_SAMPLE_DATASETS_MANIFEST_URL as string | undefined;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return null;
}

/** True when build/runtime env specifies a sample datasets source. */
export function isSampleDatasetsConfigured(): boolean {
  return Boolean(getManifestUrlFromEnv());
}

function resolveMaybeRelativeUrl(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function resolveAssetsBaseUrl(manifest: SampleDatasetsManifestV1, manifestUrl: string): string {
  // 1) manifest.baseUrl（可选）
  // 2) manifest 所在目录（默认）
  if (manifest.baseUrl?.trim()) {
    return resolveMaybeRelativeUrl(manifest.baseUrl.trim(), manifestUrl);
  }
  try {
    return new URL('./', manifestUrl).toString();
  } catch {
    return manifestUrl;
  }
}

function normalizeSamplesFromManifest(
  manifest: SampleDatasetsManifestV1,
  manifestUrl: string,
): SampleDataset[] {
  const resolvedBase = resolveAssetsBaseUrl(manifest, manifestUrl);

  return (manifest.datasets || [])
    .filter((d) => !!d && typeof d.id === 'string' && d.id.trim())
    .map((d) => {
      const title = d.title || d.name || d.id;
      const archiveUrl = d.archiveUrl?.trim()
        ? resolveMaybeRelativeUrl(d.archiveUrl.trim(), manifestUrl)
        : d.archiveFile?.trim()
          ? resolveMaybeRelativeUrl(d.archiveFile.trim(), resolvedBase)
          : '';
      const coverImageUrl = d.coverImageUrl?.trim()
        ? resolveMaybeRelativeUrl(d.coverImageUrl.trim(), manifestUrl)
        : d.coverImageFile?.trim()
          ? resolveMaybeRelativeUrl(d.coverImageFile.trim(), resolvedBase)
          : undefined;

      const version: 'v2' | 'v3' = d.version === 'v3' ? 'v3' : 'v2';

      return {
        id: d.id,
        name: title,
        title,
        description: d.description || '',
        url: archiveUrl || '',
        archiveUrl: archiveUrl || '',
        version,
        coverImageUrl,
        previewVideoUrl: d.previewVideoUrl,
      } satisfies SampleDataset;
    })
    .filter((s) => !!s.url);
}

let _cachedSamples: SampleDataset[] | null = null;
let _pendingLoad: Promise<SampleDataset[]> | null = null;

export async function loadSampleDatasets(options?: {
  forceReload?: boolean;
}): Promise<SampleDataset[]> {
  if (!options?.forceReload) {
    if (_cachedSamples) return _cachedSamples;
    if (_pendingLoad) return _pendingLoad;
  }

  const manifestUrl = getManifestUrlFromEnv();
  if (!manifestUrl) {
    _cachedSamples = [];
    return _cachedSamples;
  }

  _pendingLoad = (async () => {
    try {
      const res = await fetch(manifestUrl, { method: 'GET' });
      if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status}`);
      const json = (await res.json()) as SampleDatasetsManifestV1;
      if (!json || json.schemaVersion !== 1 || !Array.isArray(json.datasets)) {
        throw new Error('Invalid samples manifest schema');
      }
      const samples = normalizeSamplesFromManifest(json, manifestUrl);
      _cachedSamples = samples;
      return _cachedSamples;
    } catch (e) {
      console.warn('Failed to load sample datasets manifest', e);
      _cachedSamples = [];
      return _cachedSamples;
    } finally {
      _pendingLoad = null;
    }
  })();

  return _pendingLoad;
}

export async function getSampleByIdAsync(id: string): Promise<SampleDataset | undefined> {
  const samples = await loadSampleDatasets();
  return samples.find((s) => s.id === id);
}
