import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Navbar,
  SidebarTabs,
  Toaster,
  useToast,
  useKeyboardShortcuts,
  WelcomeScreen,
  useLoading,
  useOpenHistory,
  OpenRemoteArchiveDialog,
  SampleDatasetDialog,
  ExportDialog,
  DatasetHealthDialog,
  ViewerLayout,
  useLeRobotData,
  useLeRobotUi,
} from '@ioai/lerobot-studio';
import type { SampleDataset } from '@ioai/lerobot-studio-platform';
import { SourceController } from '../services/SourceController';
import { setUrlParamInLocation, type ParsedSourceUrl } from '../utils/sourceUrl';
import { getDatasetDisplayName } from '@ioai/lerobot-studio-core';
import { useUrlDrivenSourceController } from '../hooks/useUrlDrivenSourceController';
import { Upload } from 'lucide-react';

// 扩展 Window 类型以支持测试 API
declare global {
  interface Window {
    __INITIALIZE_WITH_DATASOURCE__?: (
      dataSource: DataSource | FileSystemDirectoryHandle,
    ) => Promise<void>;
    __INITIALIZE_WITH_HANDLE__?: (handle: DataSource | FileSystemDirectoryHandle) => Promise<void>;
  }
}

import type { DataSource } from '@ioai/lerobot-studio-platform';

type SeoLocale = 'en' | 'zh' | 'ja';

function normalizeSeoLocale(locale: string): SeoLocale {
  const lower = locale.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('ja')) return 'ja';
  return 'en';
}

function setMetaByName(name: string, content: string) {
  const node = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (node) node.content = content;
}

function setMetaByProperty(property: string, content: string) {
  const node = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (node) node.content = content;
}

function setCanonicalHref(href: string) {
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) canonical.href = href;
}

function upsertAlternateHrefLang(hreflang: string, href: string) {
  const selector = `link[rel="alternate"][hreflang="${hreflang}"]`;
  let node = document.head.querySelector<HTMLLinkElement>(selector);
  if (!node) {
    node = document.createElement('link');
    node.rel = 'alternate';
    node.hreflang = hreflang;
    document.head.appendChild(node);
  }
  node.href = href;
}

function updateSeoJsonLd(payload: Record<string, unknown>) {
  const node = document.getElementById('seo-jsonld-app');
  if (!node) return;
  node.textContent = JSON.stringify(payload);
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { initialize, reset, episodes, info, lastValidationReport } = useLeRobotData();
  const { healthDialogOpen, setHealthDialogOpen } = useLeRobotUi();
  const { upsertTask, completeTask, failTask, clear: clearTasks } = useLoading();
  const { history, addHistoryItem, clearHistoryHandleFlag } = useOpenHistory();

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [playbackBarVisible, setPlaybackBarVisible] = useState(true);
  const [datasetLabel, setDatasetLabel] = useState<string | undefined>(undefined);
  const [welcomeRequest, setWelcomeRequest] = useState<ParsedSourceUrl | null>(null);

  // Dialog states
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [sampleDialogOpen, setSampleDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // 启用全局键盘快捷键
  useKeyboardShortcuts(true);

  // 更新 HTML lang 属性和 SEO 元信息
  useEffect(() => {
    const locale = normalizeSeoLocale(i18n.language);
    const localeMap: Record<typeof locale, string> = {
      en: 'en_US',
      zh: 'zh_CN',
      ja: 'ja_JP',
    };
    const seoTitle = t('seo.title', 'LeRobot Visualizer - LeRobot Studio');
    const seoDescription = t(
      'seo.description',
      'LeRobot Visualizer by LeRobot Studio helps you inspect and analyze LeRobot datasets in your browser.',
    );
    const seoKeywords = t(
      'seo.keywords',
      'lerobot visualizer, lerobot dataset visualizer, robot dataset viewer, lerobot studio, robotics data visualization',
    );
    const seoOgTitle = t('seo.ogTitle', seoTitle);
    const seoOgDescription = t('seo.ogDescription', seoDescription);
    const canonical = new URL(window.location.pathname, window.location.origin).toString();
    const ogImage = document.head
      .querySelector<HTMLMetaElement>('meta[property="og:image"]')
      ?.content?.trim();
    const ogImageUrl =
      ogImage && ogImage.length > 0
        ? ogImage
        : new URL('/og-image-1200x630.png', window.location.origin).toString();

    document.documentElement.lang = locale;
    setCanonicalHref(canonical);
    setMetaByName('description', seoDescription);
    setMetaByName('keywords', seoKeywords);
    setMetaByProperty('og:title', seoOgTitle);
    setMetaByProperty('og:description', seoOgDescription);
    setMetaByProperty('og:locale', localeMap[locale]);
    setMetaByProperty('og:url', canonical);
    setMetaByName('twitter:title', seoOgTitle);
    setMetaByName('twitter:description', seoOgDescription);
    setMetaByName('twitter:image', ogImageUrl);
    upsertAlternateHrefLang('en', `${canonical}?lang=en`);
    upsertAlternateHrefLang('zh', `${canonical}?lang=zh`);
    upsertAlternateHrefLang('ja', `${canonical}?lang=ja`);
    upsertAlternateHrefLang('x-default', canonical);
    updateSeoJsonLd({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'LeRobot Studio',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      url: canonical,
      image: ogImageUrl,
      inLanguage: ['en', 'zh', 'ja'],
      description: seoDescription,
      keywords: seoKeywords,
      creator: {
        '@type': 'Organization',
        name: 'IO-AI.TECH',
        url: 'https://io-ai.tech',
      },
    });
  }, [t, i18n.language]);

  const datasetName = useMemo(
    () => getDatasetDisplayName(info, datasetLabel),
    [info, datasetLabel],
  );

  const { showToast } = useToast();

  const controller = useMemo(() => {
    return new SourceController({
      initialize,
      reset,
      upsertTask,
      completeTask,
      failTask,
      clearTasks,
      addHistoryItem,
      clearHistoryHandleFlag,
      setDatasetLabel,
      setWelcomeRequest,
      t,
      showToast,
    });
  }, [
    initialize,
    reset,
    upsertTask,
    completeTask,
    failTask,
    clearTasks,
    addHistoryItem,
    clearHistoryHandleFlag,
    t,
    showToast,
  ]);

  useUrlDrivenSourceController(controller);

  // 全局拖拽和粘贴支持
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      // 检查是否包含文件（避免误触其它页面内拖拽，如 dockview）
      // 注意：Chrome 下 types 为 DOMStringList，包含 "Files"
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
              controller.openDirectoryHandle(handle as FileSystemDirectoryHandle);
              return;
            } else if (handle && handle.kind === 'file') {
              const fileHandle = handle as FileSystemFileHandle;
              const file = await fileHandle.getFile();
              controller.openFile(file, fileHandle);
              return;
            }
          } catch (err) {
            console.warn(
              'Failed to get handle via getAsFileSystemHandle, falling back to getAsFile',
              err,
            );
          }
        }

        const droppedFiles = e.dataTransfer?.files;
        if (droppedFiles && droppedFiles.length > 0) {
          const firstFile = droppedFiles[0];
          const relativePath = firstFile.webkitRelativePath || '';
          if (relativePath.includes('/')) {
            await controller.openDirectoryFiles(droppedFiles);
            return;
          }
        }

        // 回退到常规 File API（单文件）
        const file = item.getAsFile();
        if (file) {
          controller.openFile(file);
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
            controller.openFile(file);
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
  }, [controller]);

  const handleOpenRemoteArchive = (providedUrl?: string) => {
    if (providedUrl) controller.openRemoteArchive(providedUrl);
    else setRemoteDialogOpen(true);
  };

  // Expose for testing
  useEffect(() => {
    window.__INITIALIZE_WITH_DATASOURCE__ = initialize;
    window.__INITIALIZE_WITH_HANDLE__ = initialize;
  }, [initialize]);

  const hasData = info !== null && episodes.length > 0;
  const shouldShowSidebar = hasData && sidebarVisible;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar
        onOpenDirectory={() => controller.openDirectory()}
        onOpenLocalArchive={() => controller.openLocalArchive()}
        onOpenRemoteArchive={handleOpenRemoteArchive}
        onOpenSample={() => setSampleDialogOpen(true)}
        onOpenUrl={(raw) => controller.openFromUrl(raw, 'push')}
        onRestoreHistory={(item) => controller.restoreFromHistory(item)}
        onGoHome={() => controller.openFromUrl(null, 'push')}
        onExport={hasData ? () => setExportDialogOpen(true) : undefined}
        history={history}
        datasetName={info ? datasetName : undefined}
        sidebarVisible={shouldShowSidebar}
        playbackBarVisible={playbackBarVisible}
        onToggleSidebar={hasData ? () => setSidebarVisible(!sidebarVisible) : undefined}
        onTogglePlaybackBar={hasData ? () => setPlaybackBarVisible(!playbackBarVisible) : undefined}
        validationReport={lastValidationReport ?? null}
        onOpenHealth={lastValidationReport ? () => setHealthDialogOpen(true) : undefined}
      />

      <ViewerLayout
        className="flex-1 min-h-0"
        showSidebar={shouldShowSidebar}
        showPlaybackBar={playbackBarVisible}
        showToaster={false}
        sidebar={<SidebarTabs />}
        emptyState={
          <WelcomeScreen
            onOpenDirectory={() => controller.openDirectory()}
            onOpenLocalArchive={() => controller.openLocalArchive()}
            onOpenRemoteArchive={handleOpenRemoteArchive}
            onOpenSample={() => setSampleDialogOpen(true)}
            onSelectSample={(sample) => controller.openSample(sample)}
            requested={welcomeRequest}
            onRequestUrl={(raw, mode) => setUrlParamInLocation(raw, mode)}
            onRestoreFromUrl={(parsed) => controller.restoreFromUrl(parsed)}
          />
        }
      />

      {/* Dialogs */}
      <OpenRemoteArchiveDialog
        open={remoteDialogOpen}
        onOpenChange={setRemoteDialogOpen}
        onSubmit={(url) => controller.openRemoteArchive(url)}
      />

      <SampleDatasetDialog
        open={sampleDialogOpen}
        onOpenChange={setSampleDialogOpen}
        onSelect={(sample: SampleDataset) => controller.openSample(sample)}
      />

      <ExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} />

      <DatasetHealthDialog
        open={healthDialogOpen}
        onOpenChange={setHealthDialogOpen}
        report={lastValidationReport}
      />

      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center border-2 border-dashed border-primary/50 m-4 rounded-lg pointer-events-none">
          <div className="bg-primary/10 p-6 rounded-full mb-6">
            <Upload className="h-12 w-12 text-primary animate-bounce" />
          </div>
          <h2 className="text-2xl font-bold mb-2">{t('panels.welcome.dropToOpen')}</h2>
          <p className="text-muted-foreground max-w-md">{t('panels.welcome.dropHint')}</p>
        </div>
      )}

      {/* Toast Manager */}
      <Toaster />
    </div>
  );
}
