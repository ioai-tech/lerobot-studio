import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/ui';
import { RemoteArchiveOpenForm } from './RemoteArchiveOpenForm';

interface OpenRemoteArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string) => void;
}

export const OpenRemoteArchiveDialog: React.FC<OpenRemoteArchiveDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
}) => {
  const { t } = useTranslation();

  const handleSubmit = (url: string) => {
    onSubmit(url);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('navbar.openRemoteArchive')}</DialogTitle>
          <DialogDescription>{t('dialogs.remoteArchive.description')}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <RemoteArchiveOpenForm onSubmit={handleSubmit} onCancel={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
};
