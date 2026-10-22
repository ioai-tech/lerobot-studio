import React from 'react';
import { useTranslation } from 'react-i18next';

interface ChartLineStyleKeyProps {
  kind: 'action' | 'state';
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}

/** Toolbar key: dashed line = action, solid line = state. Shows the full word, never an abbreviation. */
export const ChartLineStyleKey: React.FC<ChartLineStyleKeyProps> = ({
  kind,
  visible,
  onVisibleChange,
}) => {
  const { t } = useTranslation();
  const isAction = kind === 'action';
  const toggleTitle = isAction ? t('chart.legend.toggleAction') : t('chart.legend.toggleState');
  const lineTone = visible
    ? isAction
      ? 'text-foreground/60'
      : 'text-foreground/40'
    : 'text-muted-foreground/30';

  return (
    <div
      data-chart-key={kind}
      className="group relative flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] font-medium text-muted-foreground tracking-tight px-1.5 py-0.5 rounded hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onVisibleChange(!visible);
      }}
    >
      <input
        type="checkbox"
        checked={visible}
        onChange={(e) => {
          e.stopPropagation();
          onVisibleChange(e.target.checked);
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity w-3 h-3 cursor-pointer accent-primary shrink-0"
        title={toggleTitle}
        onClick={(e) => e.stopPropagation()}
      />
      <svg width="18" height="6" viewBox="0 0 18 6" className="overflow-visible shrink-0">
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={isAction ? '3 3' : undefined}
          className={lineTone}
        />
      </svg>
      <span className={visible ? '' : 'opacity-30'}>
        {isAction ? t('chart.series.action') : t('chart.series.state')}
      </span>
    </div>
  );
};
