import React, { useCallback } from 'react';
import type { DataSource } from '@/platform';
import type { SampleDataset } from '@/platform';
import { getArchiveUrl } from '@/platform';
import { LeRobotStudioProvider } from './LeRobotStudioProvider';
import { WelcomeScreen } from './WelcomeScreen';

export interface LeRobotWelcomeProps {
  theme?: 'light' | 'dark' | 'system';
  language?: string;
  className?: string;
  /**
   * Called when the user picks a remote URL, sample, or other openable source.
   * Host apps should open the returned value (URL string or DataSource).
   */
  onSelect?: (dataSource: string | DataSource) => void;
  onOpenDirectory?: () => void;
  onOpenLocalArchive?: () => void;
  onOpenRemoteArchive?: (url?: string) => void;
  onSelectSample?: (sample: SampleDataset) => void | Promise<void>;
}

function LeRobotWelcomeContent({
  onSelect,
  onOpenDirectory,
  onOpenLocalArchive,
  onOpenRemoteArchive,
  onSelectSample,
}: Pick<
  LeRobotWelcomeProps,
  'onSelect' | 'onOpenDirectory' | 'onOpenLocalArchive' | 'onOpenRemoteArchive' | 'onSelectSample'
>) {
  const handleOpenRemoteArchive = useCallback(
    (url?: string) => {
      if (onOpenRemoteArchive) {
        onOpenRemoteArchive(url);
        return;
      }
      if (url && onSelect) {
        onSelect(url);
      }
    },
    [onOpenRemoteArchive, onSelect],
  );

  const handleSelectSample = useCallback(
    (sample: SampleDataset) => {
      if (onSelectSample) {
        return onSelectSample(sample);
      }
      if (onSelect) {
        const archiveUrl = getArchiveUrl(sample);
        if (archiveUrl) onSelect(archiveUrl);
      }
    },
    [onSelectSample, onSelect],
  );

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="flex-1 overflow-auto">
        <WelcomeScreen
          onOpenDirectory={onOpenDirectory ?? (() => {})}
          onOpenLocalArchive={onOpenLocalArchive ?? (() => {})}
          onOpenRemoteArchive={handleOpenRemoteArchive}
          onOpenSample={() => {}}
          onSelectSample={handleSelectSample}
        />
      </div>
    </div>
  );
}

export const LeRobotWelcome: React.FC<LeRobotWelcomeProps> = ({
  theme,
  language,
  className,
  onSelect,
  onOpenDirectory,
  onOpenLocalArchive,
  onOpenRemoteArchive,
  onSelectSample,
}) => {
  return (
    <LeRobotStudioProvider theme={theme} language={language} className={className}>
      <LeRobotWelcomeContent
        onSelect={onSelect}
        onOpenDirectory={onOpenDirectory}
        onOpenLocalArchive={onOpenLocalArchive}
        onOpenRemoteArchive={onOpenRemoteArchive}
        onSelectSample={onSelectSample}
      />
    </LeRobotStudioProvider>
  );
};
