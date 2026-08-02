export type FrameLoadRequest = {
  episode: number;
  frame: number;
  key: string;
};

export function isSameFrameLoadRequest(
  left: FrameLoadRequest | null,
  right: FrameLoadRequest | null,
): boolean {
  if (!left || !right) return false;
  return left.episode === right.episode && left.frame === right.frame && left.key === right.key;
}

export function shouldCommitFrameResult(
  request: FrameLoadRequest,
  selectedEpisode: number | null,
  selectedKey: string,
  mounted: boolean,
  requestSeq: number,
  currentSeq: number,
): boolean {
  return (
    mounted &&
    requestSeq === currentSeq &&
    selectedEpisode === request.episode &&
    selectedKey === request.key
  );
}
