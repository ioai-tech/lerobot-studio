/**
 * Platform capability detection for export and video processing.
 * Used to show/hide format options (e.g. directory export) and warn when WebCodecs is unavailable.
 */

export type ExportFormat = 'zip' | 'directory';

export interface PlatformCapabilities {
  supportsFileSystemAccess: boolean;
  supportsWebCodecs: boolean;
  isReactNative: boolean;
  supportedExportFormats: ExportFormat[];
}

declare global {
  interface Window {
    __RN__?: boolean;
  }
}

export function detectPlatformCapabilities(): PlatformCapabilities {
  const isRN =
    typeof window !== 'undefined' &&
    '__RN__' in window &&
    (window as Window & { __RN__?: boolean }).__RN__ === true;

  const supportsFileSystemAccess =
    !isRN && typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const supportsWebCodecs =
    !isRN && typeof window !== 'undefined' && 'VideoDecoder' in window && 'VideoEncoder' in window;

  const supportedExportFormats: ExportFormat[] = (() => {
    if (isRN) return ['directory'];
    const formats: ExportFormat[] = ['zip'];
    if (supportsFileSystemAccess) formats.push('directory');
    return formats;
  })();

  return {
    isReactNative: isRN,
    supportsFileSystemAccess: !!supportsFileSystemAccess,
    supportsWebCodecs: !!supportsWebCodecs,
    supportedExportFormats,
  };
}
