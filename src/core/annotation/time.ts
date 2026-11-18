/**
 * Segment times shown to people. In = the first frame's time, Out = the end of
 * the last frame (exclusive), so neighbouring segments share a boundary time:
 * `#4 0:47.00–1:14.50`, `#5 1:14.50–1:31.00`.
 */

/** Seconds → `m:ss.cc` (or `h:mm:ss.cc`), rounded to the nearest hundredth. */
export function formatSegmentTime(seconds: number): string {
  const totalCentis = Math.max(0, Math.round(seconds * 100));
  const centis = totalCentis % 100;
  const totalSeconds = Math.floor(totalCentis / 100);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const tail = `${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${String(mins).padStart(2, '0')}:${tail}` : `${mins}:${tail}`;
}

/** In time of a segment that starts at `frame`. */
export function frameToInTime(frame: number, fps: number): string {
  return formatSegmentTime(frame / fps);
}

/** Out time of a segment whose last (inclusive) frame is `frame`. */
export function frameToOutTime(frame: number, fps: number): string {
  return formatSegmentTime((frame + 1) / fps);
}

/**
 * Parse `ss`, `ss.cc`, `m:ss(.cc)` or `h:mm:ss(.cc)` into seconds.
 * Returns `null` for anything else (the field keeps the text and marks it).
 */
export function parseSegmentTime(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(trimmed)) return null;
  const [main, fraction = ''] = trimmed.split('.');
  const parts = main.split(':').map(Number);
  if (parts.length > 1 && parts.slice(1).some((part) => part >= 60)) return null;
  const whole = parts.reduce((total, part) => total * 60 + part, 0);
  return whole + (fraction ? Number(`0.${fraction}`) : 0);
}

/** In text → first frame. */
export function inTimeToFrame(text: string, fps: number): number | null {
  const seconds = parseSegmentTime(text);
  return seconds == null ? null : Math.round(seconds * fps);
}

/** Out text → last (inclusive) frame. */
export function outTimeToFrame(text: string, fps: number): number | null {
  const seconds = parseSegmentTime(text);
  return seconds == null ? null : Math.round(seconds * fps) - 1;
}
