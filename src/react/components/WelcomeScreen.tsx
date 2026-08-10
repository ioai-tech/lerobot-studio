import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { DatasetSourceSelector } from './DatasetSourceSelector';
import type { SampleDataset } from '@/platform';
import { isSampleDatasetsConfigured } from '@/platform';
import { useSampleDatasets } from '../hooks/useSampleDatasets';
import { SampleDatasetList } from './open/SampleDatasetList';
import type { ParsedSourceUrl } from '../utils/sourceUrlTypes';
import { cn } from '@/ui';

interface WelcomeScreenProps {
  onOpenDirectory: () => void;
  onOpenLocalArchive: () => void;
  onOpenRemoteArchive: (url?: string) => void;
  onOpenSample: () => void;
  onSelectSample?: (sample: SampleDataset) => void | Promise<void>;
  requested?: ParsedSourceUrl | null;
  onRequestUrl?: (rawUrl: string | null, mode: 'push' | 'replace') => void;
  onRestoreFromUrl?: (requested: ParsedSourceUrl) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onOpenDirectory,
  onOpenLocalArchive,
  onOpenRemoteArchive,
  onSelectSample,
  requested,
  onRequestUrl,
  onRestoreFromUrl,
}) => {
  const { t } = useTranslation();
  const samplesConfigured = isSampleDatasetsConfigured();
  const { samples, loading: samplesLoading } = useSampleDatasets({
    enabled: samplesConfigured,
  });
  const showSamples = samplesConfigured && (samplesLoading || samples.length > 0);
  const openedSampleIntentRef = useRef<string | null>(null);
  const onSelectSampleRef = useRef(onSelectSample);
  onSelectSampleRef.current = onSelectSample;

  // Handle requested URL intent (once per sampleId; ignore unstable callback identity)
  useEffect(() => {
    if (!requested || requested.kind !== 'sample' || !requested.sampleId) {
      openedSampleIntentRef.current = null;
      return;
    }
    if (samplesLoading) return;
    if (openedSampleIntentRef.current === requested.sampleId) return;
    const sample = samples.find((s) => s.id === requested.sampleId);
    if (!sample || !onSelectSampleRef.current) return;
    openedSampleIntentRef.current = requested.sampleId;
    void onSelectSampleRef.current(sample);
  }, [requested, samples, samplesLoading]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 10, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: 'spring' as const,
        stiffness: 80,
        damping: 24,
      },
    },
  };

  const companyName = t('common.companyName');
  const [attributionBefore, attributionAfter = ''] = t('panels.welcome.attribution', {
    company: '\u0000',
  }).split('\u0000');

  const openForm = (
    <motion.div className="space-y-6" variants={itemVariants}>
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('panels.welcome.title')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('panels.welcome.subtitle')}
          </p>
        </div>
      </div>

      <DatasetSourceSelector
        onOpenDirectory={onOpenDirectory}
        onOpenLocalArchive={onOpenLocalArchive}
        onOpenRemoteArchive={onOpenRemoteArchive}
        requested={requested}
        onRequestUrl={onRequestUrl}
        onRestoreFromUrl={onRestoreFromUrl}
      />

      <div className="text-center pt-8">
        <p className="text-xs text-muted-foreground" data-readability>
          {attributionBefore}
          <a
            href={t('common.companyWebsite')}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            {companyName}
          </a>
          {attributionAfter}
        </p>
      </div>
    </motion.div>
  );

  return (
    <div className="w-full h-[calc(100vh-3rem)] overflow-y-auto bg-background text-foreground">
      <div className="relative overflow-hidden">
        <motion.div
          className={cn('mx-auto px-6 py-12 lg:py-20', showSamples ? 'max-w-6xl' : 'max-w-xl')}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Hero Section */}
          <motion.div className="text-center mb-16 space-y-6" variants={itemVariants}>
            <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground sm:text-6xl">
              {t('common.appName')}
            </h1>
            <p
              className="text-xl text-muted-foreground max-w-readable mx-auto leading-relaxed"
              data-readability
            >
              {t('panels.welcome.step2.description')}
            </p>
          </motion.div>

          {showSamples ? (
            <div className="grid lg:grid-cols-2 gap-12 items-start">
              <motion.div className="space-y-6" variants={itemVariants}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">{t('panels.welcome.samples.title')}</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t('panels.welcome.samples.description')}
                    </p>
                  </div>
                </div>

                <div className="min-h-[400px]">
                  <SampleDatasetList
                    layout="welcome"
                    onSelect={onSelectSample || (() => {})}
                    samples={samples}
                    loading={samplesLoading}
                  />
                </div>
              </motion.div>

              {openForm}
            </div>
          ) : (
            openForm
          )}
        </motion.div>
      </div>
    </div>
  );
};
