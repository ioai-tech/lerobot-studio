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

// 默认（本地）示例数据列表：当远程 manifest 不可用时回退使用
export const DEFAULT_SAMPLE_DATASETS: SampleDataset[] = [
  {
    id: 'lerobot-v3-sample',
    name: 'LeRobot v3 Sample',
    title: 'LeRobot v3 样例数据集',
    description: '预处理好的 v3 样例，含视频与传感器数据（需支持 Range）。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=450&fit=crop',
    previewVideoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  },
  {
    id: 'sample-2',
    name: 'Sample Dataset 2',
    title: '机器人抓取任务数据集',
    description: '包含多视角视频和关节数据的抓取任务样例。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&h=450&fit=crop',
    previewVideoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  },
  {
    id: 'sample-3',
    name: 'Sample Dataset 3',
    title: '移动机器人导航数据集',
    description: '室内导航场景的多传感器融合数据。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=450&fit=crop',
    previewVideoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  },
  {
    id: 'sample-4',
    name: 'Sample Dataset 4',
    title: '双臂协作操作数据集',
    description: '双臂机器人协同完成复杂装配任务。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&h=450&fit=crop',
    previewVideoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  },
  {
    id: 'sample-5',
    name: 'Sample Dataset 5',
    title: '视觉定位与建图数据集',
    description: '基于视觉的 SLAM 和定位任务数据。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=800&h=450&fit=crop',
    previewVideoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  },
  {
    id: 'sample-6',
    name: 'Sample Dataset 6',
    title: '人机交互数据集',
    description: '机器人与人类协作完成日常任务。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&h=450&fit=crop',
    previewVideoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  },
  {
    id: 'sample-7',
    name: 'Sample Dataset 7',
    title: '强化学习训练数据集',
    description: '用于 RL 训练的演示数据与轨迹记录。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=800&h=450&fit=crop',
    previewVideoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
  },
  {
    id: 'sample-8',
    name: 'Sample Dataset 8',
    title: '多模态感知数据集',
    description: '融合视觉、触觉和力觉的多模态感知数据。',
    url: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    archiveUrl: 'https://huggingface.co/datasets/lerobot/lerobot/resolve/main/lerobotv3.zip',
    version: 'v3',
    coverImageUrl:
      'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=450&fit=crop',
    previewVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  },
];

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

function getSamplesBaseUrl(): string | null {
  const raw = (import.meta as any).env?.VITE_SAMPLES_BASE_URL as string | undefined;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.endsWith('/') ? trimmed : trimmed + '/';
}

function getManifestUrl(): string | null {
  // 最高优先级：通过 baseUrl 推导 manifest 地址（你只需要改一个配置）
  const baseUrl = getSamplesBaseUrl();
  if (baseUrl) {
    try {
      return new URL('sample-datasets.manifest.json', baseUrl).toString();
    } catch {
      // ignore
    }
  }

  // 允许通过 Vite 环境变量注入（构建时）
  const fromEnv = (import.meta as any).env?.VITE_SAMPLE_DATASETS_MANIFEST_URL as string | undefined;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();

  // 默认：同源部署时放在 public 根路径
  try {
    return new URL('/sample-datasets.manifest.json', window.location.origin).toString();
  } catch {
    return null;
  }
}

function resolveMaybeRelativeUrl(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function normalizeSamplesFromManifest(
  manifest: SampleDatasetsManifestV1,
  manifestUrl: string,
): SampleDataset[] {
  // baseUrl 解析优先级：
  // 1) VITE_SAMPLES_BASE_URL（运行时/构建时只需改一个配置）
  // 2) manifest.baseUrl（可选）
  // 3) manifest 所在目录
  const envBase = getSamplesBaseUrl();
  const resolvedBase = envBase
    ? envBase
    : manifest.baseUrl?.trim()
      ? resolveMaybeRelativeUrl(manifest.baseUrl.trim(), manifestUrl)
      : (() => {
          try {
            return new URL('./', manifestUrl).toString();
          } catch {
            return manifestUrl;
          }
        })();

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

  const manifestUrl = getManifestUrl();
  if (!manifestUrl) {
    _cachedSamples = DEFAULT_SAMPLE_DATASETS;
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
      _cachedSamples = samples.length > 0 ? samples : DEFAULT_SAMPLE_DATASETS;
      return _cachedSamples;
    } catch (e) {
      console.warn('Failed to load sample datasets manifest, falling back to defaults', e);
      _cachedSamples = DEFAULT_SAMPLE_DATASETS;
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
