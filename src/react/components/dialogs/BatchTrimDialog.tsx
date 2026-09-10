import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EpisodeMetadata, EpisodeTrimRange } from '@/core';
import { fixedTrim, suggestTrim } from '../../../core/export/suggestTrim';
import { getDefaultChartFeatureKeys } from '../../../core/panels/chartFeatureSelection';
import { Pagination } from '../Pagination';
import {
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSelection,
  useLeRobotUi,
} from '../../contexts/LeRobotContext';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@/ui';

type Result = {
  episode: EpisodeMetadata;
  range: EpisodeTrimRange | null;
  status: string;
  checked: boolean;
};

export function BatchTrimDialog({
  episodes,
  onClose,
}: {
  episodes: EpisodeMetadata[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { info, dataLoader } = useLeRobotData();
  const { trimRanges, trimEpisodes, selectEpisode, deletedEpisodes } = useLeRobotSelection();
  const { setPlaying, setFrameIndex } = useLeRobotPlayback();
  const { trimSuggestion, setTrimSuggestion } = useLeRobotUi();
  const [mode, setMode] = useState('auto');
  const [before, setBefore] = useState('3');
  const [after, setAfter] = useState('3');
  const [head, setHead] = useState('0');
  const [tail, setTail] = useState('0');
  const features = getDefaultChartFeatureKeys(info).filter(
    (key) => key.startsWith('observation.') && (info?.features[key].shape.length ?? 0) <= 1,
  );
  const [feature, setFeature] = useState(
    features.includes('observation.state') ? 'observation.state' : '',
  );
  const width = info?.features[feature]?.shape[0] ?? 1;
  const [excluded, setExcluded] = useState<number[]>([]);
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high'>('medium');
  const [overwrite, setOverwrite] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [resultPage, setResultPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [undo, setUndo] = useState<Map<number, EpisodeTrimRange | null> | null>(null);
  const applied = useRef(new Map<number, EpisodeTrimRange>());
  const generation = useRef(0);
  const fps = info?.fps ?? 0;
  const left = Number(mode === 'auto' ? before : head);
  const right = Number(mode === 'auto' ? after : tail);
  const valid =
    [left, right].every((value) => Number.isFinite(value) && value >= 0) &&
    (mode === 'auto'
      ? before !== '' && after !== '' && !!feature && excluded.length < width
      : head !== '' && tail !== '') &&
    fps > 0;

  useEffect(() => {
    setPlaying(false);
  }, [setPlaying]);

  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current++;
      setTrimSuggestion(null);
    };
  }, [dataLoader, setTrimSuggestion]);

  const invalidate = () => {
    setResults([]);
    setResultPage(0);
    setNotice('');
    setUndo(null);
  };
  const close = () => {
    generation.current++;
    setPlaying(false);
    setTrimSuggestion(null);
    onClose();
  };
  const calculate = async () => {
    if (!valid || !dataLoader) return;
    const run = ++generation.current;
    setPlaying(false);
    invalidate();
    setProgress(0);
    const next: Result[] = [];
    for (const episode of episodes) {
      let range: EpisodeTrimRange | null = null;
      let status = '';
      if (deletedEpisodes.has(episode.episode_index)) status = 'deleted';
      else if (!overwrite && trimRanges.has(episode.episode_index)) status = 'existing';
      else {
        try {
          if (mode === 'fixed') range = fixedTrim(episode.length, fps, left, right);
          else {
            const columns = await dataLoader.loadAllNumericalData(episode.episode_index, [feature]);
            if (run !== generation.current) return;
            const data = columns[feature];
            if (data?.rows === episode.length && data.width === width) {
              range = suggestTrim(
                data,
                fps,
                Array.from({ length: width }, (_, i) => i).filter((i) => !excluded.includes(i)),
                left,
                right,
                sensitivity,
              );
            }
            if (!range) status = 'unreliable';
          }
        } catch {
          status = mode === 'fixed' ? 'tooShort' : 'readError';
        }
      }
      if (run !== generation.current) return;
      if (range)
        status =
          range.startFrame === 0 && range.endFrame === episode.length - 1 ? 'unchanged' : 'ready';
      next.push({ episode, range, status, checked: status === 'ready' });
      setProgress(next.length);
      // Yield between episodes so progress and cancellation remain responsive.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (run !== generation.current) return;
    }
    setResults(next);
    setProgress(null);
  };
  const preview = async (result: Result) => {
    if (!result.range || previewLoading) return;
    const run = ++generation.current;
    setPreviewLoading(true);
    setPlaying(false);
    try {
      if ((await selectEpisode(result.episode.episode_index)) && run === generation.current) {
        setPlaying(false);
        setTrimSuggestion({ episodeIndex: result.episode.episode_index, range: result.range });
        setFrameIndex(result.range.startFrame);
        setPreviewing(true);
      } else if (run === generation.current) setNotice(t('batchTrim.previewError'));
    } catch {
      if (run === generation.current) setNotice(t('batchTrim.previewError'));
    } finally {
      if (run === generation.current) setPreviewLoading(false);
    }
  };
  const returnFromPreview = () => {
    setPlaying(false);
    if (trimSuggestion)
      setResults((previous) =>
        previous.map((row) =>
          row.episode.episode_index === trimSuggestion.episodeIndex
            ? { ...row, range: trimSuggestion.range, checked: true, status: 'ready' }
            : row,
        ),
      );
    setTrimSuggestion(null);
    setPreviewing(false);
  };
  const apply = () => {
    const next = new Map<number, EpisodeTrimRange>();
    const previous = new Map<number, EpisodeTrimRange | null>();
    for (const row of results) {
      const index = row.episode.episode_index;
      if (
        !row.checked ||
        !row.range ||
        deletedEpisodes.has(index) ||
        (!overwrite && trimRanges.has(index))
      )
        continue;
      next.set(index, row.range);
      previous.set(index, trimRanges.get(index) ?? null);
    }
    trimEpisodes(next);
    applied.current = next;
    setUndo(previous);
    setNotice(t('batchTrim.applied', { count: next.size }));
  };
  const undoApply = () => {
    if (!undo) return;
    const restore = new Map<number, EpisodeTrimRange | null>();
    const lengths = new Map(episodes.map((ep) => [ep.episode_index, ep.length]));
    for (const [index, previous] of undo) {
      const expected = applied.current.get(index)!;
      const current = trimRanges.get(index);
      const length = lengths.get(index)!;
      if (
        (current?.startFrame ?? 0) === expected.startFrame &&
        (current?.endFrame ?? length - 1) === expected.endFrame
      )
        restore.set(index, previous);
    }
    trimEpisodes(restore);
    setUndo(null);
    setNotice(t('batchTrim.undone', { count: restore.size }));
  };
  const busy = progress !== null || previewLoading;
  return (
    <>
      {previewing && (
        <div className="m-2 space-y-2 rounded border bg-muted p-3 text-xs">
          <p>{t('batchTrim.previewNotice')}</p>
          <Button size="sm" onClick={returnFromPreview}>
            {t('batchTrim.return')}
          </Button>
          <Button size="sm" variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
      <Dialog
        open={!previewing}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('batchTrim.title')}</DialogTitle>
            <DialogDescription>
              {t('batchTrim.description', { count: episodes.length })}
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={busy} className="space-y-3" onChange={invalidate}>
            <label className="flex items-center gap-2 text-sm">
              {t('batchTrim.mode')}
              <select
                className="rounded border bg-background p-2"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="auto">{t('batchTrim.auto')}</option>
                <option value="fixed">{t('batchTrim.fixed')}</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label>
                {t(mode === 'auto' ? 'batchTrim.before' : 'batchTrim.head')}
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={mode === 'auto' ? before : head}
                  onChange={(e) =>
                    mode === 'auto' ? setBefore(e.target.value) : setHead(e.target.value)
                  }
                />
              </label>
              <label>
                {t(mode === 'auto' ? 'batchTrim.after' : 'batchTrim.tail')}
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={mode === 'auto' ? after : tail}
                  onChange={(e) =>
                    mode === 'auto' ? setAfter(e.target.value) : setTail(e.target.value)
                  }
                />
              </label>
            </div>
            {mode === 'auto' && (
              <>
                <p className="text-xs text-muted-foreground">{t('batchTrim.motionHint')}</p>
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  {t('batchTrim.feature')}
                  <select
                    className="max-w-full rounded border bg-background p-2"
                    value={feature}
                    onChange={(e) => {
                      setFeature(e.target.value);
                      setExcluded([]);
                    }}
                  >
                    <option value="">{t('batchTrim.chooseFeature')}</option>
                    {features.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  {t('batchTrim.sensitivity')}
                  <select
                    className="rounded border bg-background p-2"
                    value={sensitivity}
                    onChange={(e) => setSensitivity(e.target.value as typeof sensitivity)}
                  >
                    {(['low', 'medium', 'high'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`batchTrim.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {feature && (
                  <details className="text-xs">
                    <summary className="cursor-pointer">{t('batchTrim.dimensions')}</summary>
                    <div className="mt-2 flex max-h-32 flex-wrap gap-3 overflow-y-auto">
                      {Array.from({ length: width }, (_, i) => (
                        <label key={i} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={!excluded.includes(i)}
                            onChange={(e) =>
                              setExcluded((previous) =>
                                e.target.checked
                                  ? previous.filter((d) => d !== i)
                                  : [...previous, i],
                              )
                            }
                          />
                          {info?.features[feature].names?.[i] ?? `[${i}]`}
                        </label>
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              {t('batchTrim.overwrite')}
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy || !valid} onClick={() => void calculate()}>
              {t('batchTrim.calculate')}
            </Button>
            {progress !== null && (
              <>
                <span role="status" className="text-sm">
                  {t('batchTrim.progress', { done: progress, total: episodes.length })}
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    generation.current++;
                    setProgress(null);
                    setNotice(t('batchTrim.cancelled'));
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </>
            )}
          </div>
          {results.length > 0 && (
            <div className="max-h-72 overflow-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {['episode', 'original', 'range', 'removed', 'status'].map((key) => (
                      <th className="p-2" key={key}>
                        {t(`batchTrim.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results
                    .slice(resultPage * rowsPerPage, (resultPage + 1) * rowsPerPage)
                    .map((row) => (
                      <tr key={row.episode.episode_index} className="border-t">
                        <td className="p-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              aria-label={t('batchTrim.select', {
                                index: row.episode.episode_index,
                              })}
                              checked={row.checked}
                              disabled={!row.range || busy || undo !== null}
                              onChange={(e) =>
                                setResults((previous) =>
                                  previous.map((r) =>
                                    r.episode.episode_index === row.episode.episode_index
                                      ? { ...r, checked: e.target.checked }
                                      : r,
                                  ),
                                )
                              }
                            />
                            #{row.episode.episode_index}
                          </label>
                        </td>
                        <td className="p-2">{(row.episode.length / fps).toFixed(2)} s</td>
                        <td className="p-2">
                          {row.range ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy || undo !== null}
                              aria-label={t('batchTrim.preview', {
                                index: row.episode.episode_index,
                              })}
                              onClick={() => void preview(row)}
                            >
                              {(row.range.startFrame / fps).toFixed(2)}–
                              {((row.range.endFrame + 1) / fps).toFixed(2)} s
                            </Button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-2">
                          {row.range
                            ? `${((row.episode.length - row.range.endFrame + row.range.startFrame - 1) / fps).toFixed(2)} s`
                            : '—'}
                        </td>
                        <td className="p-2">{t(`batchTrim.${row.status}`)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {results.length > 0 && (
            <Pagination
              count={results.length}
              page={resultPage}
              rowsPerPage={rowsPerPage}
              onPageChange={(_, next) => setResultPage(next)}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setResultPage(0);
              }}
            />
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <DialogFooter>
            {results.length > 0 && (
              <span className="mr-auto self-center text-xs text-muted-foreground">
                {t('sidebar.selectedCount', {
                  count: results.filter((row) => row.checked && row.range).length,
                })}
              </span>
            )}
            <Button variant="outline" onClick={close}>
              {t('common.close')}
            </Button>
            {undo !== null && (
              <Button variant="outline" onClick={undoApply}>
                {t('batchTrim.undo')}
              </Button>
            )}
            <Button
              disabled={busy || undo !== null || !results.some((row) => row.checked && row.range)}
              onClick={apply}
            >
              {t('batchTrim.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
