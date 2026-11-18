import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { makeChartSeriesId } from '../components/panels/ChartPanel/chartPanelModel';
import type { ChartGroupData } from '../components/panels/ChartPanel/FeatureChartGroups';
import { nearestSampleIndex } from '../components/panels/ChartPanel/chartGroupsModel';
import { EpisodeSetDataSource } from '../../platform/datasource/EpisodeSetDataSource';
import {
  readAuxiliarySeries,
  type AuxiliarySeries,
  type AuxiliarySeriesWarning,
  type LoadedAuxiliarySeries,
} from '../../platform/services/auxiliarySeries';
import { useLeRobotData, useLeRobotSelection } from './LeRobotContext';

export interface AuxiliarySample {
  id: string;
  label: string;
  /** Time of the nearest sample, seconds from the episode start. */
  time: number;
  values: Array<{ name: string; value: number | number[] }>;
}

interface AuxiliarySeriesContextValue {
  /** Chart groups of the series that apply to the selected episode. */
  auxiliaryGroups: ChartGroupData[];
  /** Nearest sample of every applicable series at `time` (seconds). */
  samplesAt: (time: number) => AuxiliarySample[];
}

const EMPTY: AuxiliarySeriesContextValue = { auxiliaryGroups: [], samplesAt: () => [] };
const AuxiliarySeriesContext = createContext<AuxiliarySeriesContextValue>(EMPTY);

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export const useAuxiliarySeries = () => useContext(AuxiliarySeriesContext);

/** Identity of a series' data (URLs excluded, so a URL refresh never re-reads). */
function dataKey(series: AuxiliarySeries): string {
  return JSON.stringify([
    series.files.map((file) => file.logicalPath),
    series.timeColumn,
    series.timeUnit,
    series.timeOffsetNs ?? '',
    series.columns ?? null,
  ]);
}

type Entry = { key: string; state: 'loading' | 'ready' | 'failed'; data?: LoadedAuxiliarySeries };

/**
 * Loads `auxiliarySeries` with the dataset's parquet worker and exposes them
 * as chart groups and raw-panel samples. Single-dataset views only: on an
 * episode set the series are ignored with an `EPISODE_SET_UNSUPPORTED` warning.
 */
export function AuxiliarySeriesProvider({
  series,
  onWarning,
  children,
}: {
  series?: AuxiliarySeries[];
  onWarning?: (warning: AuxiliarySeriesWarning) => void;
  children: React.ReactNode;
}) {
  const { dataLoader, info } = useLeRobotData();
  const { selectedEpisodeIndex } = useLeRobotSelection();
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());
  /** Latest entries, updated synchronously so overlapping effect runs never double-read. */
  const entriesRef = useRef(entries);
  const onWarningRef = useRef(onWarning);
  onWarningRef.current = onWarning;
  /** Warnings already reported (code, series, column): each is reported once. */
  const reportedRef = useRef(new Set<string>());
  const warnRef = useRef((warning: AuxiliarySeriesWarning) => {
    const key = `${warning.code}\u0000${warning.seriesId}\u0000${warning.column ?? ''}`;
    if (reportedRef.current.has(key)) return;
    reportedRef.current.add(key);
    onWarningRef.current?.(warning);
  });
  /** Forget what was reported for a series that is read again (new data or a retry). */
  const forgetWarnings = (seriesId: string) => {
    for (const key of [...reportedRef.current]) {
      if (key.split('\u0000')[1] === seriesId) reportedRef.current.delete(key);
    }
  };
  const fps = info?.fps || 30;
  const isEpisodeSet = dataLoader?.dataSource instanceof EpisodeSetDataSource;

  useEffect(() => {
    if (!dataLoader || !info || !series?.length) return;
    if (isEpisodeSet) {
      for (const item of series) {
        warnRef.current({
          code: 'EPISODE_SET_UNSUPPORTED',
          seriesId: item.id,
          message: 'Auxiliary series apply to single-dataset views only',
        });
      }
      return;
    }
    for (const item of series) {
      const key = dataKey(item);
      const existing = entriesRef.current.get(item.id);
      // Same data (only URLs changed): keep what is loaded or loading. A
      // failed read is retried when the host passes the series again.
      if (existing && existing.key === key && existing.state !== 'failed') continue;
      forgetWarnings(item.id);
      const loading: Entry = { key, state: 'loading' };
      entriesRef.current = new Map(entriesRef.current).set(item.id, loading);
      setEntries(entriesRef.current);
      // A read settles only if it is still the latest one for this id.
      const settle = (next: Entry) => {
        if (entriesRef.current.get(item.id) !== loading) return;
        entriesRef.current = new Map(entriesRef.current).set(item.id, next);
        setEntries(entriesRef.current);
      };
      void readAuxiliarySeries(item, fps, (bytes) => dataLoader.parseParquet(bytes))
        .then((data) => {
          data.warnings.forEach((warning) => warnRef.current(warning));
          settle({ key, state: 'ready', data });
        })
        .catch((error: unknown) => {
          warnRef.current({
            code: 'READ_FAILED',
            seriesId: item.id,
            message: error instanceof Error ? error.message : String(error),
          });
          settle({ key, state: 'failed' });
        });
    }
  }, [series, dataLoader, info, fps, isEpisodeSet]);

  const applicable = useMemo(
    () =>
      (isEpisodeSet ? [] : (series ?? [])).filter(
        (item) => item.episodeIndex == null || item.episodeIndex === selectedEpisodeIndex,
      ),
    [series, selectedEpisodeIndex, isEpisodeSet],
  );

  const value = useMemo<AuxiliarySeriesContextValue>(() => {
    const loaded = applicable
      .map((item) => ({ item, entry: entries.get(item.id) }))
      .filter(
        (pair): pair is { item: AuxiliarySeries; entry: Entry & { data: LoadedAuxiliarySeries } } =>
          pair.entry?.state === 'ready' &&
          pair.entry.key === dataKey(pair.item) &&
          !!pair.entry.data,
      );
    const auxiliaryGroups: ChartGroupData[] = loaded
      .filter(({ entry }) => entry.data.time.length > 0)
      .map(({ item, entry }) => {
        const data = entry.data;
        const seriesList = data.columns.flatMap((column) =>
          Array.from({ length: column.width }, (_, d) => ({
            id: makeChartSeriesId(`aux:${item.id}:${column.name}`, d),
            label: column.width > 1 ? `${column.name}[${d}]` : column.name,
            dimIndex: d,
            column,
          })),
        );
        const byId = new Map(seriesList.map((entrySeries) => [entrySeries.id, entrySeries]));
        const cache = new Map<string, Float64Array>();
        const missing = data.warnings
          .filter((warning) => warning.code === 'COLUMN_MISSING')
          .map((warning) => warning.column)
          .filter(Boolean);
        return {
          group: {
            id: `aux:${item.id}`,
            title: item.label,
            unit: null,
            kind: 'auxiliary' as const,
            series: seriesList.map(({ id, label, dimIndex }) => ({ id, label, dimIndex })),
          },
          x: data.time,
          warning: missing.length ? `Missing: ${missing.join(', ')}` : null,
          values: (seriesId: string) => {
            let values = cache.get(seriesId);
            if (!values) {
              const entrySeries = byId.get(seriesId);
              if (!entrySeries) return undefined;
              const { column, dimIndex } = entrySeries;
              values = new Float64Array(data.time.length);
              for (let i = 0; i < values.length; i++) {
                values[i] = column.values[i * column.width + dimIndex]!;
              }
              cache.set(seriesId, values);
            }
            return values;
          },
        };
      });
    const samplesAt = (time: number): AuxiliarySample[] =>
      loaded
        .filter(({ entry }) => entry.data.time.length > 0)
        .map(({ item, entry }) => {
          const index = nearestSampleIndex(entry.data.time, time);
          return {
            id: item.id,
            label: item.label,
            time: entry.data.time[index]!,
            values: entry.data.columns.map((column) => ({
              name: column.name,
              value:
                column.width === 1
                  ? column.values[index]!
                  : Array.from(
                      column.values.subarray(index * column.width, (index + 1) * column.width),
                    ),
            })),
          };
        });
    return { auxiliaryGroups, samplesAt };
  }, [applicable, entries]);

  return (
    <AuxiliarySeriesContext.Provider value={value}>{children}</AuxiliarySeriesContext.Provider>
  );
}
