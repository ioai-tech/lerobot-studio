/**
 * IndexedDB 存储 FileSystemHandle，用于刷新后恢复本地目录/文件访问。
 * 全部操作容错：隐私模式、不支持 IndexedDB 时静默失败。
 */

const DB_NAME = 'lerobot-studio';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) return Promise.resolve(null);

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.warn('[handleStore] Failed to open IndexedDB:', request.error);
          resolve(null);
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
      } catch (e) {
        console.warn('[handleStore] IndexedDB unavailable:', e);
        resolve(null);
      }
    });
  }

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }

        try {
          const tx = db.transaction(STORE_NAME, mode);
          const store = tx.objectStore(STORE_NAME);
          const request = fn(store);

          request.onsuccess = () => {
            resolve(request.result ?? null);
          };

          request.onerror = () => {
            console.warn('[handleStore] Transaction failed:', request.error);
            resolve(null);
          };

          tx.onerror = () => {
            console.warn('[handleStore] Transaction error:', tx.error);
            resolve(null);
          };
        } catch (e) {
          console.warn('[handleStore] Transaction exception:', e);
          resolve(null);
        }
      }),
  );
}

export async function putHandle(id: string, handle: FileSystemHandle): Promise<boolean> {
  if (!id || !handle) return false;
  const result = await runTransaction('readwrite', (store) => store.put(handle, id));
  return result !== null;
}

export async function getHandle(id: string): Promise<FileSystemHandle | null> {
  if (!id) return null;
  const result = await runTransaction<FileSystemHandle>('readonly', (store) => store.get(id));
  return result ?? null;
}

export async function deleteHandle(id: string): Promise<boolean> {
  if (!id) return false;
  await runTransaction('readwrite', (store) => store.delete(id));
  return true;
}

export async function clearHandles(): Promise<boolean> {
  await runTransaction('readwrite', (store) => store.clear());
  return true;
}

/** 测试用：重置缓存的数据库连接 */
export function resetHandleStoreForTests(): void {
  dbPromise = null;
}
