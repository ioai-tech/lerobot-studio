import { useTranslation } from 'react-i18next';
import { useLeRobotPlayback } from '../../../contexts/LeRobotContext';
import { useAuxiliarySeries } from '../../../contexts/AuxiliarySeriesContext';

function format(value: number | number[]): string {
  const one = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(6)).toString() : '—');
  return Array.isArray(value) ? `[${value.map(one).join(', ')}]` : one(value);
}

/** Nearest sample of each auxiliary series at the displayed frame's time. */
export function AuxiliarySamples({ frameIndex }: { frameIndex: number }) {
  const { t } = useTranslation();
  const { currentFrames } = useLeRobotPlayback();
  const { samplesAt } = useAuxiliarySeries();
  const frame = currentFrames[Math.min(frameIndex, currentFrames.length - 1)];
  if (!frame) return null;
  const samples = samplesAt(Number(frame.timestamp ?? 0));
  if (samples.length === 0) return null;
  return (
    <section
      className="border-t border-border/50 px-3 py-2 text-xs font-mono"
      aria-label={t('panels.raw.auxiliary')}
      data-testid="raw-auxiliary-samples"
    >
      {samples.map((sample) => (
        <div key={sample.id} className="mb-1 last:mb-0">
          <div className="font-semibold text-foreground">
            {sample.label}{' '}
            <span className="font-normal text-muted-foreground">
              @ {sample.time.toFixed(3)}
              {t('units.second.short')}
            </span>
          </div>
          {sample.values.map((entry) => (
            <div key={entry.name} className="flex gap-2 text-muted-foreground">
              <span className="text-foreground">{entry.name}</span>
              <span>{format(entry.value)}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
