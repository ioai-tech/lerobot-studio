/**
 * Edit dialogs load as their own chunks on first open and then stay mounted
 * (so closing animates as before).
 */
import { useState } from 'react';
import { lazyChunk } from '../Commons/lazyChunk';
import type { EditSubtaskDialogProps } from './EditSubtaskDialog';
import type { EditTaskDialogProps } from './EditTaskDialog';

const EditSubtaskDialogChunk = lazyChunk<EditSubtaskDialogProps>(
  async () => (await import('./EditSubtaskDialog')).EditSubtaskDialog,
);
const EditTaskDialogChunk = lazyChunk<EditTaskDialogProps>(
  async () => (await import('./EditTaskDialog')).EditTaskDialog,
);

/** True from the first time `open` was true. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

export function LazyEditSubtaskDialog(props: EditSubtaskDialogProps) {
  if (!useOpenedOnce(props.open)) return null;
  return <EditSubtaskDialogChunk {...props} />;
}

export function LazyEditTaskDialog(props: EditTaskDialogProps) {
  if (!useOpenedOnce(props.open)) return null;
  return <EditTaskDialogChunk {...props} />;
}
