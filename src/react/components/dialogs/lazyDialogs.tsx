/**
 * Edit dialogs load as their own chunks on first open and then stay mounted
 * (so closing animates as before).
 */
import React, { Suspense, useState } from 'react';
import type { EditSubtaskDialogProps } from './EditSubtaskDialog';
import type { EditTaskDialogProps } from './EditTaskDialog';

const EditSubtaskDialogChunk = React.lazy(async () => ({
  default: (await import('./EditSubtaskDialog')).EditSubtaskDialog,
}));
const EditTaskDialogChunk = React.lazy(async () => ({
  default: (await import('./EditTaskDialog')).EditTaskDialog,
}));

/** True from the first time `open` was true. */
function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

export function LazyEditSubtaskDialog(props: EditSubtaskDialogProps) {
  if (!useOpenedOnce(props.open)) return null;
  return (
    <Suspense fallback={null}>
      <EditSubtaskDialogChunk {...props} />
    </Suspense>
  );
}

export function LazyEditTaskDialog(props: EditTaskDialogProps) {
  if (!useOpenedOnce(props.open)) return null;
  return (
    <Suspense fallback={null}>
      <EditTaskDialogChunk {...props} />
    </Suspense>
  );
}
