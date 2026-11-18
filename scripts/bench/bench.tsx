/* eslint-disable react-refresh/only-export-components -- bench entry, not a module */
/**
 * Playback bench page: mounts the viewer on a remote manifest
 * (`?manifest=/manifest/<name>.json`) and exposes a small control surface on
 * `window.__bench` for scripts/bench/measure-playback.mjs.
 */
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRemoteManifestDataSource,
  LeRobotStudioProvider,
  LeRobotViewerContent,
  type DataSource,
  type RemoteFileEntry,
} from '../../src/react/public-api';
import { useLeRobotData, useLeRobotPlayback } from '../../src/react/contexts/LeRobotContext';
import '../../src/react/index.css';

declare global {
  interface Window {
    __bench?: {
      ready: boolean;
      fps: number;
      frameCount: number;
      isPlaying: boolean;
      setFrame: (frame: number) => void;
      setPlaying: (playing: boolean) => void;
      getFrame: () => number;
    };
  }
}

function BenchHooks() {
  const { setFrameIndex, setPlaying, currentFrames, isPlaying } = useLeRobotPlayback();
  const { info, getFrameIndex } = useLeRobotData();
  useEffect(() => {
    window.__bench = {
      ready: currentFrames.length > 0,
      fps: info?.fps ?? 0,
      frameCount: currentFrames.length,
      isPlaying,
      setFrame: setFrameIndex,
      setPlaying,
      getFrame: getFrameIndex,
    };
  }, [currentFrames.length, info?.fps, isPlaying, setFrameIndex, setPlaying, getFrameIndex]);
  return null;
}

async function main() {
  const params = new URLSearchParams(location.search);
  const manifestUrl = params.get('manifest') ?? '/manifest/default.json';
  const expiresIn = params.get('expiresIn');
  const fetchManifest = async (): Promise<RemoteFileEntry[]> => {
    const url = expiresIn ? `${manifestUrl}?expiresIn=${expiresIn}` : manifestUrl;
    return (await fetch(url)).json();
  };
  const dataSource: DataSource = createRemoteManifestDataSource(await fetchManifest(), {
    refresh: fetchManifest,
  });
  createRoot(document.getElementById('root')!).render(
    <LeRobotStudioProvider theme="dark" language="en">
      <div style={{ height: '100vh' }}>
        <LeRobotViewerContent dataSource={dataSource} showSidebar showPlaybackBar />
      </div>
      <BenchHooks />
    </LeRobotStudioProvider>,
  );
}

void main();
