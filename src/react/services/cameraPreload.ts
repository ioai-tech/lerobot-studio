/**
 * How much a camera's `<video>` may read ahead (its `preload`).
 *
 * Every camera of a viewer reads its file from the same storage host, and a
 * browser opens at most six HTTP/1.1 connections to one host. An element on
 * `preload="auto"` keeps reading ahead while paused (megabytes per camera)
 * and does not give its connection back when a seek asks for another part of
 * the file; with four or more cameras the seek's range reads then queue
 * behind those readers for as long as they take (17 s for a 22-minute
 * 4-camera recording at 20 Mbit/s). So a camera reads ahead only while it
 * plays: paused, or while the episode's data loads, it reads what the shown
 * frame needs and lets go.
 */
export type CameraPreload = 'metadata' | 'auto';

export function cameraPreload(state: { loading: boolean; playing: boolean }): CameraPreload {
  return state.playing && !state.loading ? 'auto' : 'metadata';
}
