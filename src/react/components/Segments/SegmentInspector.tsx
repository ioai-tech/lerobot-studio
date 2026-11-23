import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CornerDownRight,
  Keyboard,
  Merge,
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
import { Button, cn } from '@/ui';
import {
  useLeRobotData,
  useLeRobotPlayback,
  useLeRobotSegments,
  useLeRobotSubtask,
  useLeRobotUi,
} from '../../contexts/LeRobotContext';
import { shortcutKeys, type SegmentShortcutId } from '../../hooks/segmentShortcuts';
import { TimeField } from './TimeField';
import { useNoticeText } from './annotationText';
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
}: {
  shortcut: SegmentShortcutId;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'ghost' | 'outline' | 'default';
  pressed?: boolean;
}) {
  const keys = shortcutKeys(shortcut);
  return (
    <Button
      type="button"
      size="xs"
      variant={variant}
      className="h-7 gap-1 px-2"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={keys.replace(/ \/ /g, ' ').replace('Ctrl/⌘', 'Control')}
      aria-pressed={pressed}
      title={`${label} (${keys})`}
    >
      {icon}
      <span>{label}</span>
      <Kbd>{keys.split(' / ')[0]}</Kbd>
    </Button>
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
  const id = React.useId();
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
      htmlFor={id}
      className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}
    >
      <span className="shrink-0">{label}</span>
      <input
        id={id}
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
  // Unique per viewer instance: two viewers on one page never share an id.
  const baseId = React.useId();
  const listId = `${baseId}-suggestions`;
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
              id={`${baseId}-add-tag`}
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
  const reviewLabel = display ? t(REVIEW_TEXT[display]) : '';

  return (
    <section
      className="flex min-w-0 flex-col gap-1.5 border-t border-border/50 px-2 pt-1.5"
      aria-label={t('segments.inspector.label')}
      data-testid="lerobot-segment-inspector"
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
            {segment.origin.kind === 'suggested' ? (
              <span className="text-[10px] text-muted-foreground">
                {segment.origin.confidence != null
                  ? t('segments.origin.suggestedConfidence', {
                      confidence: segment.origin.confidence.toFixed(2),
                    })
                  : t('segments.origin.suggested')}
              </span>
            ) : null}
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
                <ActionButton
                  shortcut="setIn"
                  label={t('segments.actions.setIn')}
                  onClick={() => segments.setEdgeAtPlayhead('start')}
                />
              </span>
              <span className="flex items-start gap-1">
                <TimeField
                  label={t('segments.inspector.out')}
                  value={frameToOutTime(segment.endFrame, fps)}
                  onCommit={(text) => commitTime('end', text)}
                />
                <ActionButton
                  shortcut="setOut"
                  label={t('segments.actions.setOut')}
                  onClick={() => segments.setEdgeAtPlayhead('end')}
                />
              </span>
              <span
                className="flex items-center gap-0.5"
                role="group"
                aria-label={t('segments.actions.nudge')}
              >
                <ActionButton
                  shortcut="nudgeBack"
                  label={t('segments.actions.nudgeBack')}
                  onClick={() => segments.nudgeEdgeNearPlayhead(-1)}
                />
                <ActionButton
                  shortcut="nudgeForward"
                  label={t('segments.actions.nudgeForward')}
                  onClick={() => segments.nudgeEdgeNearPlayhead(1)}
                />
                <ActionButton
                  shortcut="nudgeBackSecond"
                  label={t('segments.actions.nudgeBackSecond')}
                  onClick={() => segments.nudgeEdgeNearPlayhead(-framesPerSecond)}
                />
                <ActionButton
                  shortcut="nudgeForwardSecond"
                  label={t('segments.actions.nudgeForwardSecond')}
                  onClick={() => segments.nudgeEdgeNearPlayhead(framesPerSecond)}
                />
              </span>
              <TextCommitInput
                label={t('segments.inspector.task')}
                value={segment.task ?? ''}
                placeholder={t('segments.inspector.taskPlaceholder')}
                onCommit={(text) =>
                  segments.updateSegment(segment.id, { task: text.trim() === '' ? null : text })
                }
                className="min-w-56 flex-1"
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
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {segments.canEdit ? (
          <>
            <ActionButton
              shortcut="new"
              label={t('segments.actions.new')}
              icon={<Plus />}
              onClick={segments.createAtPlayhead}
            />
            <ActionButton
              shortcut="split"
              label={t('segments.actions.split')}
              icon={<Scissors />}
              onClick={segments.splitAtPlayhead}
              disabled={segments.episodeSegments.length === 0}
            />
            <ActionButton
              shortcut="merge"
              label={t('segments.actions.merge')}
              icon={<Merge />}
              onClick={segments.mergeWithNext}
              disabled={!editable}
            />
            <ActionButton
              shortcut="delete"
              label={t('segments.actions.delete')}
              icon={<Trash2 />}
              onClick={segments.deleteSelected}
              disabled={!editable}
            />
            {segments.canEditSubtasks ? (
              <>
                <ActionButton
                  shortcut="subtaskStart"
                  label={t('segments.actions.subtaskStart')}
                  icon={<CornerDownRight />}
                  onClick={() => {
                    segments.setSubtaskStart(getFrameIndex());
                    segments.showNotice('segments.notice.subtaskStartSet');
                  }}
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
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ActionButton
          shortcut="previous"
          label={t('segments.actions.previous')}
          icon={<SkipBack />}
          onClick={() => segments.selectRelative(-1)}
        />
        <ActionButton
          shortcut="next"
          label={t('segments.actions.next')}
          icon={<SkipForward />}
          onClick={() => segments.selectRelative(1)}
        />
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
        {segments.canEdit ? (
          <span className="ml-auto flex items-center gap-1">
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
