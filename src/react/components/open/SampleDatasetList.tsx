import React from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';
import type { SampleDataset } from '@/platform';
import { useSampleDatasets } from '../../hooks/useSampleDatasets';
import { SampleDatasetCard } from './SampleDatasetCard';

type Layout = 'welcome' | 'dialog';

interface SampleDatasetListProps {
  onSelect: (sample: SampleDataset) => void | Promise<void>;
  layout: Layout;
  /** 可选：外部已获取到数据时，直接传入以避免重复请求 */
  samples?: SampleDataset[];
  loading?: boolean;
}

export const SampleDatasetList: React.FC<SampleDatasetListProps> = ({
  onSelect,
  layout,
  samples: samplesProp,
  loading: loadingProp,
}) => {
  const { t } = useTranslation();
  const hasExternalData = samplesProp !== undefined;
  // Only fetch when the parent did not supply samples (hooks must be unconditional).
  const hook = useSampleDatasets({ enabled: !hasExternalData });

  const samples = samplesProp ?? hook.samples;
  const loading = loadingProp ?? hook.loading;

  const gridClassName =
    layout === 'welcome'
      ? 'grid grid-cols-2 gap-3 pb-2'
      : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4';

  if (samples.length > 0) {
    return (
      <div className={gridClassName}>
        {samples.map((sample) => (
          <SampleDatasetCard key={sample.id} sample={sample} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  // 空态/加载态
  if (layout === 'welcome') {
    return (
      <div className="text-sm text-muted-foreground rounded p-4 bg-muted/10">
        {loading ? t('common.loading') : t('dialogs.samples.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center text-muted-foreground">
      <Database className="h-12 w-12 opacity-20 mb-4" />
      <p>{loading ? t('common.loading') : t('dialogs.samples.empty')}</p>
      <p className="text-sm mt-1">{t('dialogs.samples.emptyHint')}</p>
      <p className="text-xs mt-3">{t('dialogs.samples.requirements')}</p>
    </div>
  );
};
