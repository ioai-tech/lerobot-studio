import { describe, expect, it, vi } from 'vitest';
import { canUseFileSystemAccess, supportsHandlePersistence, verifyPermission } from '@/platform';

describe('fsPermissions', () => {
  it('detects handle persistence support in Chromium-like environments', () => {
    vi.stubGlobal('window', { isSecureContext: true, showDirectoryPicker: vi.fn() });
    vi.stubGlobal('indexedDB', {});

    expect(supportsHandlePersistence()).toBe(true);

    vi.unstubAllGlobals();
  });

  it('returns false when File System Access API is unavailable', () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('indexedDB', {});

    expect(supportsHandlePersistence()).toBe(false);
    expect(canUseFileSystemAccess()).toBe(false);

    vi.unstubAllGlobals();
  });

  it('does not treat File System Access as usable on an insecure origin', () => {
    vi.stubGlobal('window', { isSecureContext: false, showDirectoryPicker: vi.fn() });
    vi.stubGlobal('indexedDB', {});

    expect(canUseFileSystemAccess()).toBe(false);
    expect(supportsHandlePersistence()).toBe(false);

    vi.unstubAllGlobals();
  });

  it('verifies permission via query then request', async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    } as unknown as FileSystemHandle;

    await expect(verifyPermission(handle, { mode: 'read' })).resolves.toBe(true);
    expect(handle.queryPermission).toHaveBeenCalledWith({});
    expect(handle.requestPermission).toHaveBeenCalledWith({});
  });

  it('returns true when queryPermission is already granted', async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn(),
    } as unknown as FileSystemHandle;

    await expect(verifyPermission(handle)).resolves.toBe(true);
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('returns false when permission methods are unavailable', async () => {
    const handle = { kind: 'file', name: 'x.zip' } as FileSystemHandle;
    await expect(verifyPermission(handle)).resolves.toBe(false);
  });
});
