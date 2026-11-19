import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  AlertTriangle,
  Download,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from '@/ui';
import type {
  LeRobotExtension,
  LeRobotNotice,
  LeRobotToolbarButton,
  LeRobotToolbarIcon,
  LeRobotToolbarLink,
  LeRobotToolbarToggle,
} from '../../contexts/hostTypes';
import { onRadioGroupKeyDown, radioTabIndex } from '../Segments/radioGroup';

const ICONS: Record<Exclude<LeRobotToolbarIcon, 'none'>, React.ElementType> = {
  sparkles: Sparkles,
  refresh: RefreshCw,
  external: ExternalLink,
  download: Download,
};

function ToolbarButton({ item }: { item: LeRobotToolbarButton }) {
  const reasonId = useId();
  const Icon = item.icon && item.icon !== 'none' ? ICONS[item.icon] : null;
  const disabled = Boolean(item.disabled || item.busy);
  const button = (
    <Button
      type="button"
      size="sm"
      variant={item.variant === 'primary' ? 'default' : 'outline'}
      className="h-7 gap-1.5 px-2.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      // Never natively disabled: focus stays put while busy, and a reason can be read.
      aria-disabled={disabled || undefined}
      aria-busy={item.busy || undefined}
      aria-describedby={item.disabled && item.disabledReason ? reasonId : undefined}
      data-host-item={item.id}
      onClick={() => {
        if (!disabled) item.onSelect();
      }}
    >
      {item.busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : Icon ? (
        <Icon className="h-3.5 w-3.5" aria-hidden />
      ) : null}
      <span className="truncate">{item.label}</span>
    </Button>
  );
  if (!item.disabled || !item.disabledReason) return button;
  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
        <TooltipContent>{item.disabledReason}</TooltipContent>
      </Tooltip>
      <span id={reasonId} hidden>
        {item.disabledReason}
      </span>
    </>
  );
}

function ToolbarToggle({ item }: { item: LeRobotToolbarToggle }) {
  const anyChecked = item.options.some((option) => option.value === item.value);
  return (
    <div
      role="radiogroup"
      aria-label={item.label}
      aria-disabled={item.disabled || undefined}
      data-host-item={item.id}
      className="inline-flex h-7 items-center rounded-md border border-border bg-muted/40 p-0.5"
      onKeyDown={onRadioGroupKeyDown}
    >
      {item.options.map((option, index) => {
        const checked = option.value === item.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={radioTabIndex(checked, index, anyChecked)}
            disabled={item.disabled}
            className={cn(
              'h-full rounded-[calc(var(--radius)*0.6)] px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
              checked
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => {
              if (!checked) item.onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ToolbarLink({ item }: { item: LeRobotToolbarLink }) {
  const { t } = useTranslation();
  return (
    <a
      href={item.href}
      data-host-item={item.id}
      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {item.label}
      {item.external ? (
        <>
          <ExternalLink className="h-3 w-3" aria-hidden />
          <span className="sr-only">{t('host.opensInNewTab')}</span>
        </>
      ) : null}
    </a>
  );
}

const NOTICE_ICONS = { info: Info, warn: AlertTriangle, error: AlertCircle } as const;

function Notice({ notice }: { notice: LeRobotNotice }) {
  const Icon = NOTICE_ICONS[notice.severity];
  const fraction =
    typeof notice.progress === 'number' ? Math.max(0, Math.min(1, notice.progress)) : null;
  return (
    <div
      // Errors interrupt; other notices are read when the person pauses.
      role={notice.severity === 'error' ? 'alert' : 'status'}
      data-host-notice={notice.id}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-xs',
        notice.severity === 'error'
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : notice.severity === 'warn'
            ? 'border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300'
            : 'border-border bg-muted/30 text-foreground',
      )}
    >
      {/* The action sits under the text, so a narrow sidebar never squeezes the text
          into one word per line beside it (s10 F-11). */}
      <span className="flex min-w-0 items-start gap-1.5">
        <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="min-w-0 max-w-full break-words" data-host-notice-text>
            {notice.text}
          </span>
          {notice.action ? (
            notice.action.href ? (
              <a
                href={notice.action.href}
                className="font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {notice.action.label}
              </a>
            ) : (
              <button
                type="button"
                className="font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => notice.action?.onSelect?.()}
              >
                {notice.action.label}
              </button>
            )
          ) : null}
        </span>
      </span>
      {notice.progress != null ? (
        <span
          role="progressbar"
          aria-label={notice.text}
          aria-valuemin={fraction == null ? undefined : 0}
          aria-valuemax={fraction == null ? undefined : 100}
          aria-valuenow={fraction == null ? undefined : Math.round(fraction * 100)}
          className="relative block h-1 w-full overflow-hidden rounded-full bg-current/15"
        >
          <span
            className={cn(
              'absolute inset-y-0 left-0 rounded-full bg-current',
              fraction == null &&
                'w-[35%] animate-indeterminate-loading motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-40',
            )}
            style={fraction == null ? undefined : { width: `${fraction * 100}%` }}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Host toolbar items and notices, in extension order. Renders nothing when
 * no extension contributes anything.
 */
export function HostChrome({
  extensions,
  className,
}: {
  extensions: readonly LeRobotExtension[] | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const items = (extensions ?? []).flatMap((extension) =>
    (extension.toolbar ?? []).map((item) => ({ key: `${extension.id}:${item.id}`, item })),
  );
  const notices = (extensions ?? []).flatMap((extension) =>
    (extension.notices ?? []).map((notice) => ({ key: `${extension.id}:${notice.id}`, notice })),
  );
  if (items.length === 0 && notices.length === 0) return null;
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-2 px-3 py-2', className)}
      data-testid="lerobot-host-chrome"
    >
      {items.length > 0 ? (
        <div
          role="group"
          aria-label={t('host.toolbar')}
          className="flex min-w-0 flex-wrap items-center gap-1.5"
        >
          {items.map(({ key, item }) =>
            item.kind === 'button' ? (
              <ToolbarButton key={key} item={item} />
            ) : item.kind === 'toggle' ? (
              <ToolbarToggle key={key} item={item} />
            ) : (
              <ToolbarLink key={key} item={item} />
            ),
          )}
        </div>
      ) : null}
      {notices.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          {notices.map(({ key, notice }) => (
            <Notice key={key} notice={notice} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
