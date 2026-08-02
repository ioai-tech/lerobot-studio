import React from 'react';
import { EpisodeSidebar } from './Sidebar/EpisodeSidebar';
import { ViewerLayout } from '../features/viewer/ViewerLayout';

interface LeRobotContentProps {
  showSidebar?: boolean;
  showPlaybackBar?: boolean;
  className?: string;
}

/** Content-only viewer (expects providers already mounted). */
export const LeRobotContent: React.FC<LeRobotContentProps> = ({
  showSidebar = true,
  showPlaybackBar = true,
  className,
}) => {
  return (
    <ViewerLayout
      showSidebar={showSidebar}
      showPlaybackBar={showPlaybackBar}
      className={className}
      sidebar={<EpisodeSidebar />}
    />
  );
};
