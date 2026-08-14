import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.id ? `${key}:${values.id}` : key,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  },
}));

vi.mock('../src/react/hooks/useSampleDatasets', () => ({
  useSampleDatasets: () => ({
    samples: [{ id: 'dualairbot_fold', name: 'DualAirbot Folding' }],
    loading: false,
    error: null,
  }),
}));

vi.mock('../src/platform/datasource/sampleDatasets.ts', () => ({
  isSampleDatasetsConfigured: () => true,
  loadSampleDatasets: async () => [],
  getSampleByIdAsync: async () => undefined,
  getArchiveUrl: () => '',
}));

vi.mock('../src/react/components/DatasetSourceSelector', () => ({
  DatasetSourceSelector: () => React.createElement('div', null, 'source-selector'),
}));

vi.mock('../src/react/components/open/SampleDatasetList', () => ({
  SampleDatasetList: () => React.createElement('div', null, 'sample-list'),
}));

import { WelcomeScreen } from '../src/react/components/WelcomeScreen';

describe('WelcomeScreen unknown sample', () => {
  it('shows an explicit error when the requested sample slug is missing', () => {
    const markup = renderToStaticMarkup(
      React.createElement(WelcomeScreen, {
        onOpenDirectory: () => undefined,
        onOpenLocalArchive: () => undefined,
        onOpenRemoteArchive: () => undefined,
        onOpenSample: () => undefined,
        requested: {
          kind: 'sample',
          raw: 'sample://dualairbot_folding',
          sampleId: 'dualairbot_folding',
        },
      }),
    );

    expect(markup).toContain('dialogs.samples.unknown:dualairbot_folding');
  });
});
