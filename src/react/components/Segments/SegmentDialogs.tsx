import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui';
import { useLeRobotSegments } from '../../contexts/LeRobotContext';
import { MARKER_STEP_KEYS, SEGMENT_SHORTCUTS } from '../../hooks/segmentShortcuts';

/** Playback keys shown in the sheet next to the segment keys. */
const PLAYBACK_KEYS: Array<{ keys: string; labelKey: string }> = [
  { keys: 'Space', labelKey: 'segments.shortcuts.playPause' },
  { keys: '← →', labelKey: 'segments.shortcuts.frameStep' },
  { keys: 'Shift+← →', labelKey: 'segments.shortcuts.frameStep10' },
  { keys: 'Home / End', labelKey: 'segments.shortcuts.firstLast' },
];

/** `?` sheet: every key, generated from the same table as the handler. */
function ShortcutSheet() {
  const { t } = useTranslation();
  const segments = useLeRobotSegments();
  const rows = [
    ...PLAYBACK_KEYS.map((row) => ({ keys: row.keys, label: t(row.labelKey), edit: false })),
    ...(segments.keyMarkerRow?.lane
      ? [
          {
            keys: `${MARKER_STEP_KEYS.previous} / ${MARKER_STEP_KEYS.next}`,
            label: t('markers.lane.keys', { label: segments.keyMarkerRow.lane.label }),
            edit: false,
          },
        ]
      : []),
    ...SEGMENT_SHORTCUTS.filter((item) => segments.canEdit || !item.edit).map((item) => ({
      keys: item.keys.join(' / '),
      label: t(`segments.actions.${item.id}`),
      edit: item.edit,
    })),
    ...(segments.canEdit
      ? segments.fields.flatMap((field) =>
          (field.options ?? [])
            .filter((option) => option.key)
            .map((option) => ({
              keys: option.key!,
              label: `${field.label}: ${option.label}`,
              edit: true,
            })),
        )
      : []),
  ];
  return (
    <Dialog open={segments.shortcutSheetOpen} onOpenChange={segments.setShortcutSheetOpen}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('segments.shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('segments.shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <table className="w-full text-left text-sm">
          <thead className="sr-only">
            <tr>
              <th>{t('segments.shortcuts.key')}</th>
              <th>{t('segments.shortcuts.action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.keys}-${row.label}`} className="border-b border-border/40">
                <td className="py-1 pr-4 align-top">
                  <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">{row.keys}</kbd>
                </td>
                <td className="py-1">{row.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}

/** Shift+A asks once before confirming every to-review segment in the current filter. */
function ConfirmAllDialog() {
  const { t } = useTranslation();
  const segments = useLeRobotSegments();
  const count = segments.toReviewInView.length;
  return (
    <Dialog open={segments.confirmAllOpen} onOpenChange={segments.setConfirmAllOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('segments.confirmAll.title', { count })}</DialogTitle>
          <DialogDescription>{t('segments.confirmAll.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => segments.setConfirmAllOpen(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            autoFocus
            onClick={() => {
              segments.confirmIds(segments.toReviewInView);
              segments.setConfirmAllOpen(false);
            }}
          >
            {t('segments.confirmAll.confirm', { count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SegmentDialogs() {
  return (
    <>
      <ShortcutSheet />
      <ConfirmAllDialog />
    </>
  );
}
