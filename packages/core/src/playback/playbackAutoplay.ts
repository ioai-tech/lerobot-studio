export interface AutoplayDecisionInput {
  totalFrames: number;
  isLoading: boolean;
  shouldAutoplay: boolean | null;
  isPlaying: boolean;
  userPaused: boolean;
  currentId: string;
  lastAutoPlayId: string | null;
}

export function shouldStartAutoplay(input: AutoplayDecisionInput): boolean {
  if (input.totalFrames <= 0) return false;
  if (input.isLoading) return false;
  if (input.shouldAutoplay !== true) return false;
  if (input.isPlaying) return false;
  if (input.userPaused) return false;
  return input.lastAutoPlayId !== input.currentId;
}
