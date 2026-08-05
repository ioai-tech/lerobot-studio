/**
 * Worker API 接口定义 - 类型契约
 * 所有 Worker 的 API 接口在这里统一定义
 */

/**
 * Parquet Worker API - 高性能 Parquet 文件解析
 */
export interface ParquetWorkerAPI {
  /**
   * 读取 Parquet 文件并返回 Arrow IPC 数据
   * @param buffer - Parquet 文件的 ArrayBuffer
   * @param columns - 可选的列名数组，如果不指定则读取所有列
   * @returns Arrow IPC 格式的数据
   */
  readParquet(buffer: ArrayBuffer, columns?: string[]): Promise<Uint8Array>;

  /**
   * 读取数值列并在 Worker 中完成行范围裁剪与物化。
   * 返回按列组织的 Float64Array buffer，主线程可直接重建 typed arrays。
   */
  readNumericColumns(
    buffer: ArrayBuffer,
    columns: string[],
    startRow: number,
    endRow: number,
  ): Promise<
    Record<
      string,
      {
        values: ArrayBuffer;
        rows: number;
        width: number;
      }
    >
  >;

  /**
   * 读取任意特征列并在 Worker 中完成行范围裁剪。
   * 用于 RawPanel 按需读取少量特征，避免主线程二次解析 Arrow。
   */
  readFeatureData(
    buffer: ArrayBuffer,
    columns: string[],
    startRow: number,
    endRow: number,
  ): Promise<Record<string, unknown[]>>;

  /**
   * 清除文件缓存
   */
  clearCache(): Promise<void>;
}

/**
 * ParquetImage Worker API - 图像提取和缓存
 */
export interface ParquetImageWorkerAPI {
  /**
   * 初始化 Worker（加载 WASM）
   */
  init(): Promise<void>;

  /**
   * 加载文件到 Worker 内存
   * @param filePath - 文件路径（用于缓存识别）
   * @param buffer - 文件的 ArrayBuffer
   * @returns 文件信息（列名和行数）
   */
  loadFile(
    filePath: string,
    buffer: ArrayBuffer,
    columns?: string[],
  ): Promise<{
    columns: string[];
    numRows: number;
  }>;

  /**
   * 从已加载文件获取图像（不需要再传 buffer）
   * @param column - 列名
   * @param rowIndex - 行索引
   * @returns 图像数据的 ArrayBuffer
   */
  getImageCached(column: string, rowIndex: number): Promise<ArrayBuffer>;

  /**
   * 清除缓存
   */
  clearCache(): Promise<void>;
}
