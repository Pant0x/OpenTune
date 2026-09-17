/**
 * Wire protocol between the main window (owns the audio engine) and the mini player window
 * (a pure remote control + display). Importing this file is safe from either side: types and
 * string constants only, no engine, no stores.
 */

export const MINI_WINDOW_LABEL = "mini";

export const PLAYBACK_SNAPSHOT_EVENT = "amber:playback-snapshot";
export const LYRICS_SNAPSHOT_EVENT = "amber:lyrics-snapshot";
export const MINI_COMMAND_EVENT = "amber:mini-command";
export const MINI_READY_EVENT = "amber:mini-ready";

export type MiniPlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface MiniTrackSnapshot {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string | null;
  durationSec: number;
}

export interface MiniPlaybackSnapshot {
  status: MiniPlayerStatus;
  track: MiniTrackSnapshot | null;
  positionSec: number;
  volume: number;
  muted: boolean;
  shuffleEnabled: boolean;
  playbackOrderMode: string;
  /** Date.now() on the main-window side, so the mini window can interpolate position. */
  sentAt: number;
}

export interface MiniLyricLine {
  text: string;
  startTimeSec?: number;
  endTimeSec?: number;
}

export interface MiniLyricsSnapshot {
  trackId: string;
  synced: boolean;
  lines: MiniLyricLine[];
}

export type MiniCommand =
  | { type: "toggle" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "seek"; positionSec: number }
  | { type: "volume"; value: number }
  | { type: "mute" }
  | { type: "shuffle" }
  | { type: "repeat" }
  | { type: "close" };
