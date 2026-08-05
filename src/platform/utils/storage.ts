/**
 * 安全的 LocalStorage 访问工具
 * 封装了 try-catch 逻辑，处理隐私模式禁用存储或存储已满等情况
 */
export const safeStorage = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`[safeStorage] Failed to get item "${key}":`, e);
      return null;
    }
  },

  setItem(key: string, value: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.error(`[safeStorage] Failed to set item "${key}":`, e);
      return false;
    }
  },

  removeItem(key: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error(`[safeStorage] Failed to remove item "${key}":`, e);
      return false;
    }
  },

  /**
   * 获取并解析 JSON 数据
   */
  getJSON<T>(key: string, defaultValue: T): T {
    const item = this.getItem(key);
    if (!item) return defaultValue;
    try {
      return JSON.parse(item) as T;
    } catch (e) {
      console.error(`[safeStorage] Failed to parse JSON for "${key}":`, e);
      return defaultValue;
    }
  },

  /**
   * 序列化并保存 JSON 数据
   */
  setJSON(key: string, value: any): boolean {
    try {
      const serialized = JSON.stringify(value);
      return this.setItem(key, serialized);
    } catch (e) {
      console.error(`[safeStorage] Failed to stringify JSON for "${key}":`, e);
      return false;
    }
  },
};
