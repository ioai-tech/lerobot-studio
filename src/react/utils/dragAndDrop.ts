import { useEffect, useState, useRef } from 'react';
import { resolveDroppedItem, type DirectoryFile } from '../../platform/utils/droppedEntries';

export type { DirectoryFile };

/** Callbacks for window-level file and folder drop (and file paste). */
export interface DragAndDropCallbacks {
  onFile: (file: File) => void;
  onDirectoryHandle?: (handle: FileSystemDirectoryHandle) => void;
  onDirectoryFiles?: (files: DirectoryFile[]) => void;
  onUnresolvedDirectory?: (name: string) => void;
}

/** Window-level drag-and-drop (and file paste) for local archives and directories. */
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

      if (!e.dataTransfer) return;
      const dropped = await resolveDroppedItem(e.dataTransfer);
      if (dropped.kind === 'directory-handle') {
        callbacksRef.current.onDirectoryHandle?.(dropped.handle);
      } else if (dropped.kind === 'directory-files') {
        callbacksRef.current.onDirectoryFiles?.(dropped.files);
      } else if (dropped.kind === 'file-handle' || dropped.kind === 'file') {
        callbacksRef.current.onFile(dropped.file);
      } else if (dropped.kind === 'unresolved-directory') {
        callbacksRef.current.onUnresolvedDirectory?.(dropped.name);
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
