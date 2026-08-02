/**
 * LRU缓存管理器 - 用于管理blob URLs和媒体资源
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;
  private readonly ownsUrls: boolean;

  /**
   * @param maxSize 最大条目数
   * @param ownsUrls 为 true 时，淘汰与 clear/delete 会对 blob: 字符串调用 revokeObjectURL（本缓存创建了 URL 时使用）
   */
  constructor(maxSize: number = 50, ownsUrls: boolean = false) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ownsUrls = ownsUrls;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 更新访问顺序：删除后重新插入
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // 如果key已存在，先删除
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // 如果超过最大容量，删除最旧的项（第一个）
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const firstValue = this.cache.get(firstKey);

        if (this.ownsUrls && typeof firstValue === 'string' && firstValue.startsWith('blob:')) {
          URL.revokeObjectURL(firstValue);
        }

        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * 移除单条；若 ownsUrls 且值为 blob URL 则 revoke。
   */
  delete(key: K): void {
    const value = this.cache.get(key);
    if (value === undefined) return;
    this.cache.delete(key);
    if (this.ownsUrls && typeof value === 'string' && value.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(value);
      } catch {
        // ignore
      }
    }
  }

  clear(): void {
    if (this.ownsUrls) {
      this.cache.forEach((value) => {
        if (typeof value === 'string' && value.startsWith('blob:')) {
          URL.revokeObjectURL(value);
        }
      });
    }
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * 图像帧缓存管理器
 */
export class ImageFrameCache {
  private cache: LRUCache<string, string>; // frameKey -> blob URL
  private loadingPromises: Map<string, Promise<string>>;

  constructor(maxSize: number = 100) {
    this.cache = new LRUCache(maxSize, true);
    this.loadingPromises = new Map();
  }

  /**
   * 获取图像blob URL，如果不存在则创建
   */
  async getFrameUrl(frameKey: string, imageData: Uint8Array | ArrayBuffer): Promise<string> {
    // 检查缓存
    const cachedUrl = this.cache.get(frameKey);
    if (cachedUrl) {
      return cachedUrl;
    }

    // 检查是否正在加载
    if (this.loadingPromises.has(frameKey)) {
      return this.loadingPromises.get(frameKey)!;
    }

    // 创建新的blob URL
    const promise = this.createBlobUrl(imageData);
    this.loadingPromises.set(frameKey, promise);

    try {
      const url = await promise;
      this.cache.set(frameKey, url);
      return url;
    } finally {
      this.loadingPromises.delete(frameKey);
    }
  }

  private async createBlobUrl(imageData: Uint8Array | ArrayBuffer): Promise<string> {
    // 确保数据是 Uint8Array 类型
    const data = imageData instanceof ArrayBuffer ? new Uint8Array(imageData) : imageData;
    // 创建一个新的 Uint8Array 来确保类型兼容性
    const buffer = new Uint8Array(data);
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  }

  /**
   * 预加载多个帧
   */
  async preloadFrames(
    frames: Array<{ key: string; data: Uint8Array | ArrayBuffer }>,
  ): Promise<void> {
    const promises = frames.map(({ key, data }) => this.getFrameUrl(key, data));
    await Promise.all(promises);
  }

  /**
   * 检查帧是否已缓存
   */
  has(frameKey: string): boolean {
    return this.cache.has(frameKey);
  }

  clear(): void {
    this.cache.clear();
    this.loadingPromises.clear();
  }

  getCacheSize(): number {
    return this.cache.size();
  }
}

/**
 * 视频URL缓存管理器
 * blob URL 由 DataSource 创建与淘汰时 revoke；本层仅做路径→URL 的查表，不 revoke。
 */
export class VideoUrlCache {
  private cache: LRUCache<string, string>; // path -> blob URL
  private loadingPromises: Map<string, Promise<string>>;

  constructor(maxSize: number = 10) {
    this.cache = new LRUCache(maxSize, false);
    this.loadingPromises = new Map();
  }

  /**
   * 获取视频URL，支持复用
   */
  getUrl(path: string, url: string): string {
    // 如果已缓存且是相同路径，返回缓存的URL
    const cachedUrl = this.cache.get(path);
    if (cachedUrl) {
      return cachedUrl;
    }

    // 缓存新URL
    this.cache.set(path, url);
    return url;
  }

  /**
   * 检查是否已缓存
   */
  has(path: string): boolean {
    return this.cache.has(path);
  }

  /**
   * 获取缓存的URL
   */
  get(path: string): string | undefined {
    return this.cache.get(path);
  }

  /** 丢弃某路径的缓存条目（不 revoke URL，由 DataSource 负责） */
  invalidate(path: string): void {
    this.cache.delete(path);
    this.loadingPromises.delete(path);
  }

  clear(): void {
    this.cache.clear();
    this.loadingPromises.clear();
  }
}
