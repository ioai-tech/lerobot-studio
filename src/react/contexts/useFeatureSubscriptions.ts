import { useCallback, useEffect, useRef } from 'react';
import type { LeRobotFeature, LeRobotInfo } from '@/core';
import type { LeRobotDataLoader, NumericalColumnMap } from '@/platform';

export function materializeNumericFeatureRows(column: NumericalColumnMap[string]): unknown[] {
  const rows: unknown[] = [];
  for (let rowIndex = 0; rowIndex < column.rows; rowIndex++) {
    const offset = rowIndex * column.width;
    rows.push(
      column.width <= 1
        ? (column.values[offset] ?? 0)
        : Array.from(column.values.slice(offset, offset + column.width)),
    );
  }
  return rows;
}

type FeatureSnapshot = {
  episodeIndex: number | null;
  loader: LeRobotDataLoader | null;
  info: LeRobotInfo | null;
  chartData: NumericalColumnMap;
  featureData: Record<string, unknown[]>;
};

type FeatureSubscriptionBatcherOptions = {
  getSnapshot: () => FeatureSnapshot;
  onFeatureData: (data: Record<string, unknown[]>) => void;
  schedule?: (callback: () => void, delay: number) => number;
  cancel?: (timer: number) => void;
  onError?: (message: string, error: unknown) => void;
};

function isMediaFeature(feature: LeRobotFeature | undefined): boolean {
  return feature?.dtype === 'image' || feature?.dtype === 'video';
}

export class FeatureSubscriptionBatcher {
  private readonly subscriptions: Record<string, number> = {};
  private readonly pending = new Set<string>();
  private readonly loading = new Set<string>();
  private readonly options: FeatureSubscriptionBatcherOptions;
  private timer: number | null = null;
  private generation = 0;

  constructor(options: FeatureSubscriptionBatcherOptions) {
    this.options = options;
  }

  subscribe(featureName: string): Promise<void> {
    this.subscriptions[featureName] = (this.subscriptions[featureName] ?? 0) + 1;
    const snapshot = this.options.getSnapshot();
    if (isMediaFeature(snapshot.info?.features[featureName])) return Promise.resolve();
    if (this.subscriptions[featureName] === 1 && snapshot.featureData[featureName] === undefined) {
      this.pending.add(featureName);
      this.ensureScheduled();
    }
    return Promise.resolve();
  }

  unsubscribe(featureName: string): void {
    if ((this.subscriptions[featureName] ?? 0) > 0) {
      this.subscriptions[featureName] -= 1;
    }
  }

  getSubscribedFeatureNames(info: LeRobotInfo): string[] {
    return Object.entries(this.subscriptions)
      .filter(([name, count]) => count > 0 && !isMediaFeature(info.features[name]))
      .map(([name]) => name);
  }

  clearPending(): void {
    this.generation += 1;
    this.pending.clear();
    this.loading.clear();
    if (this.timer !== null) {
      (this.options.cancel ?? window.clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.clearPending();
  }

  async flush(): Promise<void> {
    this.timer = null;
    const generation = this.generation;
    const snapshot = this.options.getSnapshot();
    if (snapshot.episodeIndex === null || !snapshot.loader || !snapshot.info) {
      this.pending.clear();
      return;
    }

    const queued = Array.from(this.pending).filter((featureName) => {
      if (this.loading.has(featureName)) return false;
      if (snapshot.featureData[featureName] !== undefined) return false;
      return !isMediaFeature(snapshot.info?.features[featureName]);
    });
    if (queued.length === 0) {
      this.pending.clear();
      return;
    }

    queued.forEach((featureName) => {
      this.pending.delete(featureName);
      this.loading.add(featureName);
    });

    const eagerData: Record<string, unknown[]> = {};
    const missingFeatures: string[] = [];
    queued.forEach((featureName) => {
      const numericalColumn = snapshot.chartData[featureName];
      if (numericalColumn) {
        eagerData[featureName] = materializeNumericFeatureRows(numericalColumn);
      } else {
        missingFeatures.push(featureName);
      }
    });

    if (
      Object.keys(eagerData).length > 0 &&
      this.options.getSnapshot().episodeIndex === snapshot.episodeIndex
    ) {
      this.options.onFeatureData(eagerData);
    }

    try {
      if (missingFeatures.length > 0) {
        const data = await snapshot.loader.loadFeatureData(snapshot.episodeIndex, missingFeatures);
        if (
          generation === this.generation &&
          this.options.getSnapshot().episodeIndex === snapshot.episodeIndex
        ) {
          this.options.onFeatureData(data);
        }
      }
    } catch (error) {
      this.options.onError?.(
        `Failed to load batched feature data for episode ${snapshot.episodeIndex}`,
        error,
      );
    } finally {
      if (generation === this.generation) {
        queued.forEach((featureName) => this.loading.delete(featureName));
        if (this.pending.size > 0) this.ensureScheduled();
      }
    }
  }

  private ensureScheduled(): void {
    if (this.timer !== null) return;
    this.timer = (this.options.schedule ?? window.setTimeout)(() => {
      void this.flush();
    }, 0);
  }
}

type UseFeatureSubscriptionsOptions = {
  selectedEpisodeIndex: number | null;
  dataLoader: LeRobotDataLoader | null;
  info: LeRobotInfo | null;
  chartData: NumericalColumnMap;
  featureData: Record<string, unknown[]>;
  setFeatureData: React.Dispatch<React.SetStateAction<Record<string, unknown[]>>>;
};

export function useFeatureSubscriptions({
  selectedEpisodeIndex,
  dataLoader,
  info,
  chartData,
  featureData,
  setFeatureData,
}: UseFeatureSubscriptionsOptions) {
  const snapshotRef = useRef<FeatureSnapshot>({
    episodeIndex: selectedEpisodeIndex,
    loader: dataLoader,
    info,
    chartData,
    featureData,
  });
  snapshotRef.current = {
    episodeIndex: selectedEpisodeIndex,
    loader: dataLoader,
    info,
    chartData,
    featureData,
  };

  const batcherRef = useRef<FeatureSubscriptionBatcher | null>(null);
  if (!batcherRef.current) {
    batcherRef.current = new FeatureSubscriptionBatcher({
      getSnapshot: () => snapshotRef.current,
      onFeatureData: (data) => setFeatureData((previous) => ({ ...previous, ...data })),
      onError: (message, error) => console.error(message, error),
    });
  }

  useEffect(() => {
    batcherRef.current?.clearPending();
  }, [selectedEpisodeIndex]);

  useEffect(() => {
    return () => batcherRef.current?.dispose();
  }, []);

  const subscribeFeature = useCallback(
    (featureName: string) => batcherRef.current!.subscribe(featureName),
    [],
  );
  const unsubscribeFeature = useCallback((featureName: string) => {
    batcherRef.current!.unsubscribe(featureName);
  }, []);
  const clearPendingFeatureLoads = useCallback(() => {
    batcherRef.current!.clearPending();
  }, []);
  const getSubscribedFeatureNames = useCallback(
    (currentInfo: LeRobotInfo) => batcherRef.current!.getSubscribedFeatureNames(currentInfo),
    [],
  );

  return {
    subscribeFeature,
    unsubscribeFeature,
    clearPendingFeatureLoads,
    getSubscribedFeatureNames,
  };
}
