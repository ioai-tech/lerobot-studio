export type FileSystemPermissionMode = 'read' | 'readwrite';

export interface VerifyPermissionOptions {
  mode?: FileSystemPermissionMode;
}

/**
 * True only when File System Access pickers/handles are safe to call.
 *
 * Chrome still exposes `showDirectoryPicker` on `http://192.168.x.x`, but the
 * browser process then kills the tab:
 * "File System Access access from Unsecure Origin".
 */
export function canUseFileSystemAccess(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  return typeof window.showDirectoryPicker === 'function';
}

/**
 * 检测当前环境是否支持将 FileSystemHandle 持久化到 IndexedDB 并恢复。
 */
export function supportsHandlePersistence(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof indexedDB === 'undefined') return false;
  return canUseFileSystemAccess();
}

/**
 * 验证/请求文件或目录句柄的访问权限。
 * 从 IndexedDB 恢复的 handle 通常需要先 requestPermission（需用户点击触发）。
 */
export async function verifyPermission(
  handle: FileSystemHandle,
  options: VerifyPermissionOptions = {},
): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = {};
  if (options.mode === 'readwrite') {
    opts.mode = 'readwrite';
  }

  if (
    typeof handle.queryPermission !== 'function' ||
    typeof handle.requestPermission !== 'function'
  ) {
    return false;
  }

  try {
    if ((await handle.queryPermission(opts)) === 'granted') {
      return true;
    }

    if ((await handle.requestPermission(opts)) === 'granted') {
      return true;
    }
  } catch (e) {
    console.warn('[fsPermissions] Permission check failed:', e);
  }

  return false;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}
