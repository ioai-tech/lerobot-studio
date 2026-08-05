interface LastLoadedFrame {
  episode: number;
  frame: number;
  key: string;
}

export function shouldSkipFrameLoad(
  lastLoaded: LastLoadedFrame | null,
  episode: number,
  frame: number,
  key: string,
  loading: boolean,
): boolean {
  if (loading) return true;
  if (!lastLoaded) return false;
  return lastLoaded.episode === episode && lastLoaded.frame === frame && lastLoaded.key === key;
}

export function isLatestRequest(requestToken: number, latestToken: number): boolean {
  return requestToken === latestToken;
}

export function shouldShowInitialImageLoading(currentImageUrl: string | null): boolean {
  return !currentImageUrl;
}
