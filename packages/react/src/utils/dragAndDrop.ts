import { useEffect, useState, useRef } from 'react';

interface DragAndDropCallbacks {
  onFile: (file: File) => void;
  onDirectoryHandle?: (handle: FileSystemDirectoryHandle) => void;
}

export function useDragAndDrop(callbacks: DragAndDropCallbacks) {
  const [isDragging, setIsDragging] = useState(false);
  const callbacksRef = useRef(callbacks);

  // Update ref whenever callbacks change, but don't re-bind events
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      // 检查是否包含文件（避免误触其它页面内拖拽）
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // 只有当离开整个窗口时才关闭 overlay
      if (e.relatedTarget === null) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const items = e.dataTransfer?.items;
      if (!items || items.length === 0) return;

      const item = items[0];
      // 优先尝试获取目录句柄
      if (item.kind === 'file') {
        if ('getAsFileSystemHandle' in item) {
          try {
            const itemWithHandle = item as DataTransferItem & {
              getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
            };
            if (!itemWithHandle.getAsFileSystemHandle) return;

            const handle = await itemWithHandle.getAsFileSystemHandle();
            if (handle && handle.kind === 'directory') {
              callbacksRef.current.onDirectoryHandle?.(handle as FileSystemDirectoryHandle);
              return;
            } else if (handle && handle.kind === 'file') {
              const file = await (handle as FileSystemFileHandle).getFile();
              callbacksRef.current.onFile(file);
              return;
            }
          } catch (err) {
            console.warn(
              'Failed to get handle via getAsFileSystemHandle, falling back to getAsFile',
              err,
            );
          }
        }

        // 回退到常规 File API
        const file = item.getAsFile();
        if (file) {
          callbacksRef.current.onFile(file);
        }
      }
    };

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            callbacksRef.current.onFile(file);
            break;
          }
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
    };
  }, []); // Only bind once

  return { isDragging };
}
