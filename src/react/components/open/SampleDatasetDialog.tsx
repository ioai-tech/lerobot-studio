import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/ui';
import { ScrollArea } from '@/ui';
import { Button } from '@/ui';
import type { SampleDataset } from '@/platform';
import { SampleDatasetList } from './SampleDatasetList';
import { ArrowUpRightIcon } from 'lucide-react';

interface SampleDatasetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (sample: SampleDataset) => void | Promise<void>;
}

export const SampleDatasetDialog: React.FC<SampleDatasetDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
}) => {
  const { t } = useTranslation();

  const handleSelect = async (sample: SampleDataset) => {
    const result = onSelect(sample);

    // 如果返回 Promise，等待完成后再关闭对话框
    if (result && typeof result === 'object' && 'then' in result) {
      try {
        await result;
      } catch (error) {
        console.error('Failed to select sample:', error);
        // 即使失败也关闭对话框
      }
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[90vw] max-w-6xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('common.browseLeRobot')}</DialogTitle>
          <DialogDescription>{t('dialogs.samples.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full pr-4">
            <SampleDatasetList layout="dialog" onSelect={handleSelect} />

            {/* dialog 专属：底部操作 */}
            <div className="mt-4 flex items-center gap-8">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
              <a
                href="https://huggingface.co/lerobot/datasets"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-primary underline flex items-center gap-1"
              >
                {t('dialogs.samples.openDirect')}
                <ArrowUpRightIcon className="w-4 h-4" />
              </a>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};
