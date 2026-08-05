import { useEffect, useRef } from 'react';
import { getUrlParamFromLocation } from '../utils/sourceUrl';
import type { SourceController } from '../services/SourceController';

/**
 * 让 SourceController 由 URL 驱动：
 * - 首次进入：读取 ?url=（兼容 dataset/data）并打开
 * - 浏览器前进/后退：popstate 时重新按 URL 打开
 *
 * 注：React StrictMode 下 effect 可能执行两次，这里用 ref 防抖，避免重复打开。
 */
export function useUrlDrivenSourceController(controller: SourceController) {
  const didInitRef = useRef(false);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const url = getUrlParamFromLocation();
    if (url) void controllerRef.current.openFromUrl(url, 'replace');
  }, []);

  useEffect(() => controller.attachPopstateListener(), [controller]);
}
