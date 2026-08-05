import React from 'react';
import { AspectRatio } from '@/ui';
import { Play } from 'lucide-react';
import type { SampleDataset } from '@/platform';
import { useTranslation } from 'react-i18next';

interface SampleDatasetCardProps {
  sample: SampleDataset;
  onSelect: (sample: SampleDataset) => void | Promise<void>;
  fallbackImageUrl?: string;
}

export const SampleDatasetCard: React.FC<SampleDatasetCardProps> = ({
  sample,
  onSelect,
  fallbackImageUrl,
}) => {
  const { t } = useTranslation();
  const title = sample.title || sample.name;
  const coverImageUrl = sample.coverImageUrl;
  const [imgError, setImgError] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const loadingTimerRef = React.useRef<number | null>(null);
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // 清理定时器
      if (loadingTimerRef.current) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, []);

  const handleCardClick = async () => {
    // 防止重复点击
    if (isLoading) return;

    setIsLoading(true);

    // 最多等待 10 秒后自动取消加载状态
    loadingTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      loadingTimerRef.current = null;
    }, 10000);

    try {
      const result = onSelect(sample);

      // 如果返回 Promise，等待它完成
      if (result && typeof result === 'object' && 'then' in result) {
        await result;
      }
    } catch (error) {
      console.error('Failed to select sample:', error);
    } finally {
      // 清理定时器
      if (loadingTimerRef.current) {
        window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }

      // 仅在组件仍挂载时更新状态
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  return (
    <div
      className={`cursor-pointer transition-all hover:opacity-90 rounded-lg overflow-hidden border border-border bg-card ${
        isLoading ? 'opacity-75 pointer-events-none' : ''
      }`}
      onClick={handleCardClick}
    >
      <AspectRatio ratio={16 / 9} className="overflow-hidden bg-muted relative">
        {coverImageUrl && !imgError ? (
          <img
            src={coverImageUrl}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {fallbackImageUrl ? (
              <img
                src={fallbackImageUrl}
                alt="Default Cover"
                className="h-12 w-12 opacity-50 object-contain"
              />
            ) : (
              <div className="text-center">
                <Play className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs">{title}</p>
              </div>
            )}
          </div>
        )}

        {/* 加载状态遮罩层 - 纯 CSS 动画 */}
        {isLoading && (
          <div
            className="absolute inset-0 bg-background/60 flex items-center justify-center"
            role="status"
            aria-live="polite"
            aria-label={t('common.loading')}
          >
            <div className="loading-spinner" aria-hidden />
          </div>
        )}
      </AspectRatio>
      <div className="p-2">
        <h3 className="font-medium text-xs line-clamp-1 text-foreground">{title}</h3>
      </div>
    </div>
  );
};
