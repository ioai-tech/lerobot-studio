import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ResizableSidebarProps {
  children: React.ReactNode;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  onWidthChange?: (width: number) => void;
  className?: string;
}

export const ResizableSidebar: React.FC<ResizableSidebarProps> = ({
  children,
  minWidth = 200,
  maxWidth = 600,
  defaultWidth = 256,
  onWidthChange,
  className = '',
}) => {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(defaultWidth);
  const rafIdRef = useRef<number | null>(null);
  const minMainContentWidth = 320;

  // 使用 ref 存储最新的值，避免闭包问题
  const minWidthRef = useRef(minWidth);
  const maxWidthRef = useRef(maxWidth);
  const onWidthChangeRef = useRef(onWidthChange);
  const getEffectiveMaxWidth = useCallback(() => {
    const viewportLimit = Math.max(minWidthRef.current, window.innerWidth - minMainContentWidth);
    return Math.min(maxWidthRef.current, viewportLimit);
  }, [minMainContentWidth]);

  useEffect(() => {
    minWidthRef.current = minWidth;
    maxWidthRef.current = maxWidth;
    onWidthChangeRef.current = onWidthChange;
  }, [minWidth, maxWidth, onWidthChange]);

  // 高性能拖动处理：使用 requestAnimationFrame 和直接 DOM 操作
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizingRef.current || !sidebarRef.current) return;

      // 取消之前的 RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // 使用 requestAnimationFrame 确保流畅的动画
      rafIdRef.current = requestAnimationFrame(() => {
        const deltaX = e.clientX - startXRef.current;
        const effectiveMaxWidth = getEffectiveMaxWidth();
        const newWidth = Math.max(
          minWidthRef.current,
          Math.min(effectiveMaxWidth, startWidthRef.current + deltaX),
        );

        // 直接操作 DOM，避免拖拽时频繁重渲染
        if (sidebarRef.current) {
          sidebarRef.current.style.width = `${newWidth}px`;
        }

        // 更新 state（用于同步，但不触发重新渲染）
        setWidth(newWidth);
        onWidthChangeRef.current?.(newWidth);
      });
    },
    [getEffectiveMaxWidth],
  );

  const handleMouseUp = useCallback(() => {
    if (!isResizingRef.current) return;

    isResizingRef.current = false;
    setIsResizing(false);

    // 恢复全局样式
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // 恢复过渡动画
    if (sidebarRef.current) {
      sidebarRef.current.style.transition = '';
    }
    if (splitterRef.current) {
      splitterRef.current.style.transition = '';
    }

    // 取消 RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      isResizingRef.current = true;
      setIsResizing(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;

      // 设置全局样式
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      // 移除过渡动画（拖动时不应该有动画）
      if (sidebarRef.current) {
        sidebarRef.current.style.transition = 'none';
      }
      if (splitterRef.current) {
        splitterRef.current.style.transition = 'none';
      }
    },
    [width],
  );

  // 管理全局事件监听器
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove, { passive: true });
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // 兜底：如果组件在调整大小时卸载，恢复全局样式
      if (isResizingRef.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const handleResize = () => {
      const effectiveMaxWidth = getEffectiveMaxWidth();
      if (width > effectiveMaxWidth) {
        setWidth(effectiveMaxWidth);
        if (sidebarRef.current) {
          sidebarRef.current.style.width = `${effectiveMaxWidth}px`;
        }
        onWidthChangeRef.current?.(effectiveMaxWidth);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [width, getEffectiveMaxWidth]);

  return (
    <>
      <div
        ref={sidebarRef}
        className={`flex h-full min-w-0 shrink-0 flex-col overflow-x-hidden border-r bg-background ${className}`}
        style={{
          width: `${width}px`,
          minWidth: `${minWidth}px`,
          maxWidth: `${maxWidth}px`,
          transition: 'width 0.2s ease-out',
        }}
      >
        {children}
      </div>
      <div
        ref={splitterRef}
        className={`relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors duration-200 hover:bg-primary/30 ${
          isResizing ? 'bg-primary/60' : ''
        }`}
        onMouseDown={handleMouseDown}
        style={{ cursor: 'col-resize' }}
      >
        <div className="absolute inset-y-0 left-0 w-4" />
      </div>
    </>
  );
};
