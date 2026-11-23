import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CornerDownRight,
  Keyboard,
  Merge,
  MoreHorizontal,
  Plus,
  Redo2,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  frameToInTime,
  frameToOutTime,
  inTimeToFrame,
  outTimeToFrame,
  segmentNumber,
  segmentReviewDisplay,
  type AnnotationField,
  type Segment,
} from '@/core';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/ui';
import {
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSegments,
  useLeRobotSubtask,
  useLeRobotUi,
} from '../../contexts/LeRobotContext';
import { shortcutKeys, type SegmentShortcutId } from '../../hooks/segmentShortcuts';
import { TimeField } from './TimeField';
import { useNoticeText, useOriginText } from './annotationText';
import { onRadioGroupKeyDown, radioTabIndex } from './radioGroup';
import { BADGE_LOOK, REVIEW_TEXT } from './reviewDisplay';

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border/80 bg-background px-1 font-mono text-[10px] leading-4 text-muted-foreground">
      {children}
    </kbd>
  );
}

function ActionButton({
  shortcut,
  label,
  icon,
  onClick,
  disabled,
  variant = 'ghost',
  pressed,
  iconOnly = false,
}: {
  shortcut: SegmentShortcutId;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'ghost' | 'outline' | 'default';
  pressed?: boolean;
  /** Compact bar: the icon alone; the label and key stay in the name and tooltip. */
  iconOnly?: boolean;
}) {
  const keys = shortcutKeys(shortcut);
  const bare = iconOnly && icon != null;
  return (
    <Button
      type="button"
      size="xs"
      variant={variant}
      className={cn('h-7 gap-1', bare ? 'w-7 px-0' : 'px-2')}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={ariaKeys(keys)}
      aria-pressed={pressed}
      aria-label={bare ? label : undefined}
      title={`${label} (${keys})`}
    >
      {icon}
      {bare ? null : (
        <>
          <span>{label}</span>
          <Kbd>{keys.split(' / ')[0]}</Kbd>
        </>
      )}
    </Button>
  );
}

function ariaKeys(keys: string): string {
  return keys.replace(/ \/ /g, ' ').replace('Ctrl/⌘', 'Control');
}

/** The details panel uses its compact form below this width of its own (px)… */
export const COMPACT_INSPECTOR_MAX_WIDTH_PX = 960;
/** …or while the whole viewer is shorter than this (px): the panels keep their room. */
export const COMPACT_INSPECTOR_MAX_VIEWER_HEIGHT_PX = 760;

/**
 * True while the details panel should be compact (F-07): narrower than
 * `COMPACT_INSPECTOR_MAX_WIDTH_PX`, or in a viewer shorter than
 * `COMPACT_INSPECTOR_MAX_VIEWER_HEIGHT_PX`. Both are inputs the compact form
 * does not change, so it never flips back and forth.
 */
function useCompactInspector(ref: React.RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  React.useLayoutEffect(() => {
    const section = ref.current;
    if (!section) return;
    const viewer = section.closest<HTMLElement>('[data-testid="lerobot-viewer-layout"]');
    const update = () => {
      const width = section.getBoundingClientRect().width;
      const height = viewer?.getBoundingClientRect().height ?? Number.POSITIVE_INFINITY;
      if (width <= 0) return;
      setCompact(
        width < COMPACT_INSPECTOR_MAX_WIDTH_PX ||
          (height > 0 && height < COMPACT_INSPECTOR_MAX_VIEWER_HEIGHT_PX),
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(section);
    if (viewer) observer.observe(viewer);
    return () => observer.disconnect();
  }, [ref]);
  return compact;
}

type MoreAction = {
  shortcut: SegmentShortcutId;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  checked?: boolean;
};

/** The compact bar's overflow: the less frequent actions, each with its key. */
function MoreActions({ actions }: { actions: MoreAction[] }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-7 w-7 px-0"
            aria-label={t('segments.actions.more')}
            title={t('segments.actions.more')}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {actions.map((action) => {
          const keys = shortcutKeys(action.shortcut);
          return (
            <DropdownMenuItem
              key={action.shortcut}
              disabled={action.disabled}
              aria-keyshortcuts={ariaKeys(keys)}
              onClick={action.onSelect}
              className="text-xs"
            >
              {action.checked != null ? (
                <Check className={cn('h-3.5 w-3.5', !action.checked && 'invisible')} aria-hidden />
              ) : null}
              <span>{action.label}</span>
              <DropdownMenuShortcut>{keys.split(' / ')[0]}</DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TextCommitInput({
  label,
  value,
  placeholder,
  disabled,
  onCommit,
  list,
  className,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
  list?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [editing, value]);
  /** Set by Enter / Escape so the blur that follows does not commit again. */
  const settledRef = React.useRef(false);
  const commit = () => {
    setEditing(false);
    if (settledRef.current) {
      settledRef.current = false;
      return;
    }
    if (text !== value) onCommit(text);
  };
  return (
    <label
      className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}
    >
      <span className="shrink-0">{label}</span>
      <input
        type="text"
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        list={list}
        onFocus={() => {
          settledRef.current = false;
          setEditing(true);
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            settledRef.current = true;
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            // Revert: the typed text is never committed.
            event.preventDefault();
            event.stopPropagation();
            setText(value);
            setEditing(false);
            settledRef.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function FieldControl({
  field,
  segment,
  editable,
  onChange,
}: {
  field: AnnotationField;
  segment: Segment;
  editable: boolean;
  onChange: (value: string | string[] | null) => void;
}) {
  const { t } = useTranslation();
  const value = segment.values[field.id] ?? null;
  // Unique per viewer instance: two viewers on one page never share a datalist.
  const listId = `${React.useId()}-suggestions`;
  if (field.kind === 'select' && !editable) {
    // Read-only shows the chosen value as text, not disabled toggles that look
    // pressable (s10 F-16), like a read-only text field.
    const chosen = (field.options ?? []).find((option) => option.value === value);
    return (
      <span className="flex min-w-0 items-center gap-1 text-xs" data-field-value={field.id}>
        <span className="text-muted-foreground">{field.label}</span>
        <span className="truncate">{chosen?.label ?? '—'}</span>
      </span>
    );
  }
  if (field.kind === 'select') {
    const options = field.options ?? [];
    const anyChecked = options.some((option) => option.value === value);
    return (
      <div
        role="radiogroup"
        aria-label={field.label}
        className="flex flex-wrap items-center gap-1 text-xs"
        onKeyDown={onRadioGroupKeyDown}
      >
        <span className="text-muted-foreground">{field.label}</span>
        {options.map((option, index) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={radioTabIndex(active, index, anyChecked)}
              aria-keyshortcuts={option.key}
              disabled={!editable}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input text-foreground hover:bg-accent disabled:hover:bg-transparent',
              )}
              onClick={() => onChange(active ? null : option.value)}
            >
              {option.label}
              {option.key && editable ? <Kbd>{option.key}</Kbd> : null}
            </button>
          );
        })}
      </div>
    );
  }
  if (field.kind === 'tags') {
    const tags = Array.isArray(value) ? value : [];
    return (
      <div
        className="flex min-w-0 flex-wrap items-center gap-1 text-xs"
        role="group"
        aria-label={field.label}
      >
        <span className="text-muted-foreground">{field.label}</span>
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-6 items-center gap-1 rounded-full bg-secondary px-2 text-secondary-foreground"
          >
            {tag}
            {editable ? (
              <button
                type="button"
                className="rounded-full hover:text-destructive"
                aria-label={t('segments.inspector.removeTag', { tag })}
                onClick={() => onChange(tags.filter((item) => item !== tag))}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {editable ? (
          <>
            <input
              type="text"
              aria-label={t('segments.inspector.addTag', { field: field.label })}
              placeholder={t('segments.inspector.addTagPlaceholder')}
              list={field.suggestions?.length ? listId : undefined}
              className="h-6 w-28 rounded-md border border-input bg-transparent px-1.5 text-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const next = event.currentTarget.value.trim();
                if (next && !tags.includes(next)) onChange([...tags, next]);
                event.currentTarget.value = '';
              }}
            />
            {field.suggestions?.length ? (
              <datalist id={listId}>
                {field.suggestions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            ) : null}
          </>
        ) : tags.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : null}
      </div>
    );
  }
  const text = typeof value === 'string' ? value : '';
  if (!editable) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-xs">
        <span className="text-muted-foreground">{field.label}</span>
        <span className="truncate">{text || '—'}</span>
      </span>
    );
  }
  return (
    <>
      <TextCommitInput
        label={field.label}
        value={text}
        list={field.suggestions?.length ? listId : undefined}
        onCommit={(next) => onChange(next.trim() === '' ? null : next)}
        className="min-w-48 flex-1"
      />
      {field.suggestions?.length ? (
        <datalist id={listId}>
          {field.suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

/** Save state and the last action's result, announced politely. */
function StatusLine() {
  const { t } = useTranslation();
  const segments = useLeRobotSegments();
  const noticeText = useNoticeText();
  const save = segments.saveState;
  const notice = segments.notice;
  const text = noticeText(notice);
  const saveText =
    save && save.kind !== 'idle'
      ? save.message
        ? `${t(`segments.save.${save.kind}`)} · ${save.message}`
        : t(`segments.save.${save.kind}`)
      : null;
  return (
    <div
      className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      role="status"
      aria-live="polite"
      data-testid="lerobot-segment-status"
    >
      {text ? (
        <span
          className={cn(notice?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
        >
          {text}
        </span>
      ) : null}
      {notice?.undo && segments.canUndo ? (
        <Button
          type="button"
          size="xs"
          variant="link"
          className="h-5 px-0"
          // The link disappears after undo; useFocusRecovery keeps focus in the viewer.
          onClick={() => segments.undo()}
        >
          {t('segments.actions.undo')}
        </Button>
      ) : null}
      {saveText ? (
        <span
          className={cn(
            'ml-auto',
            save?.kind === 'refused' || save?.kind === 'offline'
              ? 'text-destructive'
              : save?.kind === 'saved'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-muted-foreground',
          )}
        >
          {save?.kind === 'saved' ? <Check className="mr-0.5 inline h-3 w-3" /> : null}
          {saveText}
        </span>
      ) : null}
      {save?.actions?.map((action) => (
        <Button
          key={action.id}
          type="button"
          size="xs"
          variant="outline"
          className="h-6"
          onClick={action.onSelect}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Inspector for the selected segment: In / Out, task, host fields, the
 * actions (each with its key), undo / redo and the status line.
 */
export const SegmentInspector: React.FC = () => {
  const { t } = useTranslation();
  const { info, getFrameIndex } = useLeRobotData();
  const { setPlaying } = useLeRobotPlayback();
  const segments = useLeRobotSegments();
  const { beginPendingRange } = useLeRobotSubtask();
  const { setSubtaskDialogOpen } = useLeRobotUi();
  const noticeText = useNoticeText();
  const originText = useOriginText();
  const fps = info?.fps || 30;
  const framesPerSecond = Math.max(1, Math.round(fps));
  const selected = segments.selected;
  const segment = selected?.segment ?? null;
  const editable = segments.canEdit && !segment?.readOnly;
  const number = useMemo(
    () => (selected ? segmentNumber(segments.doc, selected.episodeIndex, selected.segment.id) : 0),
    [segments.doc, selected],
  );

  const commitTime = (edge: 'start' | 'end', text: string): string | null => {
    if (!segment) return null;
    const frame = edge === 'start' ? inTimeToFrame(text, fps) : outTimeToFrame(text, fps);
    if (frame == null) return t('segments.inspector.timeInvalid');
    const ok = segments.setRange(segment.id, {
      startFrame: edge === 'start' ? frame : segment.startFrame,
      endFrame: edge === 'end' ? frame : segment.endFrame,
    });
    return ok
      ? null
      : (noticeText(segments.getLastNotice()) ?? t('segments.inspector.timeInvalid'));
  };

  const subtaskEnd = () => {
    const start = segments.subtaskStart;
    if (start == null) {
      segments.showNotice('segments.notice.subtaskStartFirst', undefined, 'error');
      return;
    }
    setPlaying(false);
    if (beginPendingRange(start, getFrameIndex())) {
      segments.setSubtaskStart(null);
      setSubtaskDialogOpen(true);
    } else {
      segments.showNotice('segments.notice.subtaskInvalid', undefined, 'error');
    }
  };

  const display = segment ? segmentReviewDisplay(segment) : null;
  const origin = segment ? originText(segment.origin) : null;
  const reviewLabel = display ? t(REVIEW_TEXT[display]) : '';
  const sectionRef = React.useRef<HTMLElement>(null);
  const compact = useCompactInspector(sectionRef);

  const startSubtask = () => {
    segments.setSubtaskStart(getFrameIndex());
    segments.showNotice('segments.notice.subtaskStartSet');
  };
  const nudgeActions: MoreAction[] = editable
    ? [
        {
          shortcut: 'nudgeBack',
          label: t('segments.actions.nudgeBack'),
          onSelect: () => segments.nudgeEdgeNearPlayhead(-1),
        },
        {
          shortcut: 'nudgeForward',
          label: t('segments.actions.nudgeForward'),
          onSelect: () => segments.nudgeEdgeNearPlayhead(1),
        },
        {
          shortcut: 'nudgeBackSecond',
          label: t('segments.actions.nudgeBackSecond'),
          onSelect: () => segments.nudgeEdgeNearPlayhead(-framesPerSecond),
        },
        {
          shortcut: 'nudgeForwardSecond',
          label: t('segments.actions.nudgeForwardSecond'),
          onSelect: () => segments.nudgeEdgeNearPlayhead(framesPerSecond),
        },
      ]
    : [];
  // The compact bar keeps the review loop's actions in sight and folds the rest
  // into More, each still on its key (F-07).
  const moreActions: MoreAction[] = compact
    ? [
        ...(editable
          ? [
              {
                shortcut: 'setIn' as const,
                label: t('segments.actions.setIn'),
                onSelect: () => segments.setEdgeAtPlayhead('start'),
              },
              {
                shortcut: 'setOut' as const,
                label: t('segments.actions.setOut'),
                onSelect: () => segments.setEdgeAtPlayhead('end'),
              },
            ]
          : []),
        ...nudgeActions,
        {
          shortcut: 'nextUncovered',
          label: t('segments.actions.nextUncovered'),
          onSelect: segments.jumpToNextUncovered,
        },
        {
          shortcut: 'loop',
          label: t('segments.actions.loop'),
          onSelect: segments.toggleLoop,
          checked: segments.loop,
        },
        ...(segments.canEditSubtasks
          ? [
              {
                shortcut: 'subtaskStart' as const,
                label: t('segments.actions.subtaskStart'),
                onSelect: startSubtask,
                checked: segments.subtaskStart != null,
              },
              {
                shortcut: 'subtaskEnd' as const,
                label: t('segments.actions.subtaskEnd'),
                onSelect: subtaskEnd,
                disabled: segments.subtaskStart == null,
              },
            ]
          : []),
        ...(segments.canEdit
          ? [
              {
                shortcut: 'undo' as const,
                label: t('segments.actions.undo'),
                onSelect: segments.undo,
                disabled: !segments.canUndo,
              },
              {
                shortcut: 'redo' as const,
                label: t('segments.actions.redo'),
                onSelect: segments.redo,
                disabled: !segments.canRedo,
              },
            ]
          : []),
        {
          shortcut: 'help',
          label: t('segments.actions.help'),
          onSelect: () => segments.setShortcutSheetOpen(true),
        },
      ]
    : [];

  return (
    <section
      ref={sectionRef}
      className="flex min-w-0 flex-col gap-1.5 border-t border-border/50 px-2 pt-1.5"
      aria-label={t('segments.inspector.label')}
      data-testid="lerobot-segment-inspector"
      data-compact={compact ? '' : undefined}
    >
      {segments.editNeedsWiderWindow ? (
        <p className="text-xs text-muted-foreground" data-testid="lerobot-narrow-editing">
          {t('segments.narrowEditing')}
        </p>
      ) : null}
      {segment ? (
        <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5 self-center text-xs font-medium">
            <span className="font-mono">#{number}</span>
            <span
              className={cn('rounded px-1.5 py-0.5 text-[10px]', display && BADGE_LOOK[display])}
            >
              {reviewLabel}
            </span>
            {origin ? <span className="text-[10px] text-muted-foreground">{origin}</span> : null}
            {segment.status ? (
              <span
                className={cn(
                  'text-[10px]',
                  segment.status.severity === 'info' ? 'text-muted-foreground' : 'text-destructive',
                )}
              >
                {segment.status.label}
                {segment.status.count != null ? ` · ${segment.status.count}` : ''}
              </span>
            ) : null}
            {segment.readOnly ? (
              <span className="text-[10px] text-muted-foreground">{t('segments.readOnly')}</span>
            ) : null}
          </span>
          {editable ? (
            <>
              <span className="flex items-start gap-1">
                <TimeField
                  label={t('segments.inspector.in')}
                  value={frameToInTime(segment.startFrame, fps)}
                  onCommit={(text) => commitTime('start', text)}
                />
                {compact ? null : (
                  <ActionButton
                    shortcut="setIn"
                    label={t('segments.actions.setIn')}
                    onClick={() => segments.setEdgeAtPlayhead('start')}
                  />
                )}
              </span>
              <span className="flex items-start gap-1">
                <TimeField
                  label={t('segments.inspector.out')}
                  value={frameToOutTime(segment.endFrame, fps)}
                  onCommit={(text) => commitTime('end', text)}
                />
                {compact ? null : (
                  <ActionButton
                    shortcut="setOut"
                    label={t('segments.actions.setOut')}
                    onClick={() => segments.setEdgeAtPlayhead('end')}
                  />
                )}
              </span>
              {compact ? null : (
                <span
                  className="flex items-center gap-0.5"
                  role="group"
                  aria-label={t('segments.actions.nudge')}
                >
                  {nudgeActions.map((action) => (
                    <ActionButton
                      key={action.shortcut}
                      shortcut={action.shortcut}
                      label={action.label}
                      onClick={action.onSelect}
                    />
                  ))}
                </span>
              )}
              <TextCommitInput
                label={t('segments.inspector.task')}
                value={segment.task ?? ''}
                placeholder={t('segments.inspector.taskPlaceholder')}
                onCommit={(text) =>
                  segments.updateSegment(segment.id, { task: text.trim() === '' ? null : text })
                }
                className={compact ? 'min-w-40 flex-1' : 'min-w-56 flex-1'}
              />
            </>
          ) : (
            <span className="flex min-w-0 items-center gap-3 self-center text-xs">
              <span className="font-mono tabular-nums">
                {frameToInTime(segment.startFrame, fps)}–{frameToOutTime(segment.endFrame, fps)}
              </span>
              <span className="truncate">{segment.task ?? t('segments.inheritTask')}</span>
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {segments.canEdit ? t('segments.inspector.noneEditable') : t('segments.inspector.none')}
        </p>
      )}
      {segment && segments.fields.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
          {segments.fields.map((field) => (
            <FieldControl
              key={field.id}
              field={field}
              segment={segment}
              editable={editable}
              onChange={(value) => segments.setFieldValue(field.id, value)}
            />
          ))}
        </div>
      ) : null}
      <div
        className="flex min-w-0 flex-wrap items-center gap-1"
        data-testid="lerobot-segment-actions"
      >
        {segments.canEdit ? (
          <>
            <ActionButton
              shortcut="new"
              label={t('segments.actions.new')}
              icon={<Plus />}
              onClick={segments.createAtPlayhead}
              iconOnly={compact}
            />
            <ActionButton
              shortcut="split"
              label={t('segments.actions.split')}
              icon={<Scissors />}
              onClick={segments.splitAtPlayhead}
              disabled={segments.episodeSegments.length === 0}
              iconOnly={compact}
            />
            <ActionButton
              shortcut="merge"
              label={t('segments.actions.merge')}
              icon={<Merge />}
              onClick={segments.mergeWithNext}
              disabled={!editable}
              iconOnly={compact}
            />
            <ActionButton
              shortcut="delete"
              label={t('segments.actions.delete')}
              icon={<Trash2 />}
              onClick={segments.deleteSelected}
              disabled={!editable}
              iconOnly={compact}
            />
            {segments.canEditSubtasks && !compact ? (
              <>
                <ActionButton
                  shortcut="subtaskStart"
                  label={t('segments.actions.subtaskStart')}
                  icon={<CornerDownRight />}
                  onClick={startSubtask}
                  pressed={segments.subtaskStart != null}
                />
                <ActionButton
                  shortcut="subtaskEnd"
                  label={t('segments.actions.subtaskEnd')}
                  onClick={subtaskEnd}
                  disabled={segments.subtaskStart == null}
                />
              </>
            ) : null}
          </>
        ) : null}
        <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
        <ActionButton
          shortcut="previous"
          label={t('segments.actions.previous')}
          icon={<SkipBack />}
          onClick={() => segments.selectRelative(-1)}
          iconOnly={compact}
        />
        <ActionButton
          shortcut="next"
          label={t('segments.actions.next')}
          icon={<SkipForward />}
          onClick={() => segments.selectRelative(1)}
          iconOnly={compact}
        />
        {compact ? (
          <MoreActions actions={moreActions} />
        ) : (
          <>
            <ActionButton
              shortcut="nextUncovered"
              label={t('segments.actions.nextUncovered')}
              onClick={segments.jumpToNextUncovered}
            />
            <ActionButton
              shortcut="loop"
              label={t('segments.actions.loop')}
              icon={<Repeat />}
              onClick={segments.toggleLoop}
              pressed={segments.loop}
              variant={segments.loop ? 'outline' : 'ghost'}
            />
            {segments.canEdit ? (
              <>
                <ActionButton
                  shortcut="undo"
                  label={t('segments.actions.undo')}
                  icon={<Undo2 />}
                  onClick={segments.undo}
                  disabled={!segments.canUndo}
                />
                <ActionButton
                  shortcut="redo"
                  label={t('segments.actions.redo')}
                  icon={<Redo2 />}
                  onClick={segments.redo}
                  disabled={!segments.canRedo}
                />
              </>
            ) : null}
            <ActionButton
              shortcut="help"
              label={t('segments.actions.help')}
              icon={<Keyboard />}
              onClick={() => segments.setShortcutSheetOpen(true)}
            />
          </>
        )}
        {segments.canEdit ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <ActionButton
              shortcut="confirmAll"
              label={t('segments.actions.confirmAll')}
              onClick={() =>
                segments.toReviewInView.length === 0
                  ? segments.showNotice('segments.notice.noneToReview')
                  : segments.setConfirmAllOpen(true)
              }
              disabled={segments.toReviewInView.length === 0}
              variant="outline"
            />
            <ActionButton
              shortcut="confirm"
              label={t('segments.actions.confirm')}
              icon={<Check />}
              onClick={segments.confirmSelected}
              disabled={!editable || display !== 'to_review'}
              variant="default"
            />
          </span>
        ) : null}
      </div>
      <StatusLine />
    </section>
  );
};
